// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PackedUserOperationV07} from "../bootstrap/ConveyBootstrapPaymasterV07.sol";

interface IExitEntryPointV07 {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function withdrawStake(address payable withdrawAddress) external;
}

interface IExitAssetRegistry {
    function isGiftable(address token) external view returns (bool);
}

/// @notice Separate sponsorship policy for receiver exits.
/// @dev Claims use ConveyClaimPaymasterV07 and sender-funded gift reserves.
///      This paymaster has an independent owner-controlled EntryPoint deposit
///      and only accepts the two exact exit shapes used by the application:
///      a Uniswap exactInput cash-out with an approval reset, or one ERC-20
///      transfer for withdrawal.
contract ConveyExitPaymasterV07 {
    uint256 public constant XLAYER_CHAIN_ID = 196;
    uint256 public constant MAX_AUTHORIZATION_WINDOW = 300;
    uint256 public constant EXIT_PAYMASTER_DATA_LENGTH = 141;
    uint256 public constant PAYMASTER_AND_DATA_LENGTH = 20 + 16 + 16 + EXIT_PAYMASTER_DATA_LENGTH;

    bytes4 public constant OKX_EXECUTE_USER_OP_SELECTOR = 0x8dd7712f;
    bytes4 public constant ERC20_APPROVE_SELECTOR = 0x095ea7b3;
    bytes4 public constant ERC20_TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 public constant UNISWAP_EXACT_INPUT_SELECTOR = 0xc04b8d59;

    uint8 private constant OP_SUCCEEDED = 0;
    uint8 private constant SIG_VALIDATION_FAILED = 1;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("ConveyExitPaymaster");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "ExitAuthorization(address entryPoint,address paymaster,bytes32 accountOperationHash,bytes32 actionHash,uint256 maxCost,uint128 paymasterVerificationGasLimit,uint128 paymasterPostOpGasLimit,uint48 validAfter,uint48 validUntil,uint256 sponsorNonce)"
    );

    error WrongChain();
    error InvalidEntryPoint();
    error InvalidOwner();
    error InvalidPolicy();
    error OnlyOwner();
    error OnlyEntryPoint();
    error CostCapExceeded();
    error MalformedPaymasterAndData();
    error InvalidValidityWindow();
    error SponsorAuthorizationAlreadyUsed();
    error InvalidExitOperation();
    error InvalidSponsorNonce();
    error InsufficientSurplus();
    error InvalidRecipient();
    error InvalidRefund();
    error ReentrantCall();

    event ExitAuthorizationConsumed(address indexed account, bytes32 indexed actionHash, uint256 sponsorNonce);
    event ExitSettled(uint8 mode, address indexed account, uint256 actualGasCost, uint256 prechargedCost, uint256 refunded);
    event RefundDeferred(address indexed recipient, uint256 amount);
    event RefundWithdrawn(address indexed recipient, uint256 amount);

    IExitEntryPointV07 public immutable entryPoint;
    address public immutable owner;
    address public immutable verifyingSigner;
    IExitAssetRegistry public immutable registry;
    address public immutable router;
    address public immutable usdt0;
    uint256 public immutable maxExitCost;

    uint256 public inFlightTotal;
    uint256 public pendingRefundTotal;
    mapping(uint256 sponsorNonce => bool used) public usedSponsorNonces;
    mapping(address recipient => uint256 amount) public pendingRefunds;
    uint256 private _lock = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address owner_,
        address verifyingSigner_,
        address registry_,
        address router_,
        address usdt0_,
        uint256 maxExitCost_
    ) {
        if (block.chainid != XLAYER_CHAIN_ID) revert WrongChain();
        address entryPointAddress = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
        if (entryPointAddress.code.length == 0) revert InvalidEntryPoint();
        if (owner_ == address(0) || owner_ == verifyingSigner_ || verifyingSigner_ == address(0)) revert InvalidOwner();
        if (registry_ == address(0) || router_ == address(0) || usdt0_ == address(0) || maxExitCost_ == 0) {
            revert InvalidPolicy();
        }
        entryPoint = IExitEntryPointV07(entryPointAddress);
        owner = owner_;
        verifyingSigner = verifyingSigner_;
        registry = IExitAssetRegistry(registry_);
        router = router_;
        usdt0 = usdt0_;
        maxExitCost = maxExitCost_;
    }

    function validatePaymasterUserOp(
        PackedUserOperationV07 calldata userOp,
        bytes32,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        if (block.chainid != XLAYER_CHAIN_ID) revert WrongChain();
        if (maxCost == 0 || maxCost > maxExitCost) revert CostCapExceeded();
        if (userOp.paymasterAndData.length != PAYMASTER_AND_DATA_LENGTH) revert MalformedPaymasterAndData();
        if (address(bytes20(userOp.paymasterAndData[0:20])) != address(this)) revert MalformedPaymasterAndData();

        (
            bytes32 actionHash,
            uint48 validAfter,
            uint48 validUntil,
            uint256 sponsorNonce,
            uint128 verificationGasLimit,
            uint128 postOpGasLimit,
            bytes memory signature
        ) = _decodePaymasterData(userOp.paymasterAndData);
        if (validUntil == 0 || validUntil <= validAfter || uint256(validUntil) - uint256(validAfter) > MAX_AUTHORIZATION_WINDOW) {
            revert InvalidValidityWindow();
        }
        if (usedSponsorNonces[sponsorNonce]) revert SponsorAuthorizationAlreadyUsed();
        if (keccak256(userOp.callData) != actionHash) revert InvalidExitOperation();
        _validateExitOperation(userOp.sender, userOp.callData);

        bytes32 digest = _authorizationDigest(
            _accountOperationHash(userOp),
            actionHash,
            maxCost,
            verificationGasLimit,
            postOpGasLimit,
            validAfter,
            validUntil,
            sponsorNonce
        );
        if (_recover(digest, signature) != verifyingSigner) return (bytes(""), SIG_VALIDATION_FAILED);

        usedSponsorNonces[sponsorNonce] = true;
        inFlightTotal += maxCost;
        emit ExitAuthorizationConsumed(userOp.sender, actionHash, sponsorNonce);
        context = abi.encode(maxCost, sponsorNonce, userOp.sender);
        validationData = (uint256(validAfter) << 208) | (uint256(validUntil) << 160);
    }

    function postOp(
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256
    ) external nonReentrant onlyEntryPoint {
        (uint256 prechargedCost, uint256 sponsorNonce, address account) = abi.decode(context, (uint256, uint256, address));
        if (!usedSponsorNonces[sponsorNonce]) revert InvalidSponsorNonce();
        if (inFlightTotal < prechargedCost) revert InvalidSponsorNonce();
        inFlightTotal -= prechargedCost;
        uint256 refund = prechargedCost > actualGasCost ? prechargedCost - actualGasCost : 0;
        _withdrawOrCredit(account, refund);
        emit ExitSettled(mode, account, actualGasCost, prechargedCost, refund);
    }

    function withdrawPendingRefund(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > pendingRefunds[msg.sender]) revert InvalidRefund();
        pendingRefunds[msg.sender] -= amount;
        pendingRefundTotal -= amount;
        entryPoint.withdrawTo(payable(msg.sender), amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    function withdrawSurplus(address payable recipient, uint256 amount) external nonReentrant onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 balance = entryPoint.balanceOf(address(this));
        uint256 locked = inFlightTotal + pendingRefundTotal;
        if (balance < locked || amount > balance - locked) revert InsufficientSurplus();
        entryPoint.withdrawTo(recipient, amount);
    }

    function deposit() external payable onlyOwner {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    function withdrawStake(address payable recipient) external onlyOwner {
        entryPoint.withdrawStake(recipient);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function authorizationDigest(
        bytes32 operationFieldsHash,
        bytes32 actionHash,
        uint256 maxCost,
        uint128 paymasterVerificationGasLimit,
        uint128 paymasterPostOpGasLimit,
        uint48 validAfter,
        uint48 validUntil,
        uint256 sponsorNonce
    ) external view returns (bytes32) {
        return _authorizationDigest(
            operationFieldsHash,
            actionHash,
            maxCost,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit,
            validAfter,
            validUntil,
            sponsorNonce
        );
    }

    function accountOperationHash(PackedUserOperationV07 calldata userOp) external pure returns (bytes32) {
        return _accountOperationHash(userOp);
    }

    function _validateExitOperation(address sender, bytes calldata callData) private view {
        if (callData.length < 4 || bytes4(callData[0:4]) != OKX_EXECUTE_USER_OP_SELECTOR) revert InvalidExitOperation();
        ExitCall[] memory calls = abi.decode(callData[4:], (ExitCall[]));
        if (calls.length == 1) {
            _validateTransfer(calls[0], sender);
            return;
        }
        if (calls.length != 3) revert InvalidExitOperation();

        (address spender, uint256 amount) = _decodeApprove(calls[0].data);
        address inputToken = calls[0].target;
        if (spender != router || amount == 0 || calls[0].value != 0) revert InvalidExitOperation();
        if (!_isGiftable(inputToken)) revert InvalidExitOperation();

        if (calls[1].target != router || calls[1].value != 0) revert InvalidExitOperation();
        (bytes memory path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) =
            _decodeExactInput(calls[1].data);
        if (recipient != sender || amountIn != amount || amountOutMinimum == 0 || deadline < block.timestamp || deadline > block.timestamp + 300) {
            revert InvalidExitOperation();
        }
        _validatePath(path, inputToken);

        (address resetSpender, uint256 resetAmount) = _decodeApprove(calls[2].data);
        if (calls[2].target != inputToken || resetSpender != router || resetAmount != 0 || calls[2].value != 0) {
            revert InvalidExitOperation();
        }
    }

    function _validateTransfer(ExitCall memory call, address sender) private view {
        if (call.value != 0 || (!_isGiftable(call.target) && call.target != usdt0)) revert InvalidExitOperation();
        (address recipient, uint256 amount) = _decodeTransfer(call.data);
        if (recipient == address(0) || recipient == sender || amount == 0) revert InvalidExitOperation();
    }

    function _isGiftable(address token) private view returns (bool) {
        try registry.isGiftable(token) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    function _validatePath(bytes memory path, address inputToken) private view {
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert InvalidExitOperation();
        address first;
        address last;
        assembly ("memory-safe") {
            first := shr(96, mload(add(path, 0x20)))
            last := shr(96, mload(add(add(path, 0x20), sub(mload(path), 20))))
        }
        if (first != inputToken || last != usdt0) revert InvalidExitOperation();
    }

    function _decodeApprove(bytes memory data) private pure returns (address spender, uint256 amount) {
        if (data.length != 68) revert InvalidExitOperation();
        bytes4 selector;
        uint256 rawSpender;
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
            rawSpender := mload(add(data, 0x24))
            amount := mload(add(data, 0x44))
        }
        if (selector != ERC20_APPROVE_SELECTOR) revert InvalidExitOperation();
        spender = address(uint160(rawSpender));
    }

    function _decodeTransfer(bytes memory data) private pure returns (address recipient, uint256 amount) {
        if (data.length != 68) revert InvalidExitOperation();
        bytes4 selector;
        uint256 rawRecipient;
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
            rawRecipient := mload(add(data, 0x24))
            amount := mload(add(data, 0x44))
        }
        if (selector != ERC20_TRANSFER_SELECTOR) revert InvalidExitOperation();
        recipient = address(uint160(rawRecipient));
    }

    function _decodeExactInput(bytes memory data)
        private
        pure
        returns (bytes memory path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)
    {
        if (data.length < 4) revert InvalidExitOperation();
        bytes memory encoded = new bytes(data.length - 4);
        for (uint256 index = 4; index < data.length; index++) encoded[index - 4] = data[index];
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
        if (selector != UNISWAP_EXACT_INPUT_SELECTOR) revert InvalidExitOperation();
        (path, recipient, deadline, amountIn, amountOutMinimum) = abi.decode(encoded, (bytes, address, uint256, uint256, uint256));
    }

    function _decodePaymasterData(bytes calldata paymasterAndData)
        private
        pure
        returns (
            bytes32 actionHash,
            uint48 validAfter,
            uint48 validUntil,
            uint256 sponsorNonce,
            uint128 verificationGasLimit,
            uint128 postOpGasLimit,
            bytes memory signature
        )
    {
        bytes calldata encoded = paymasterAndData[52:];
        actionHash = bytes32(encoded[0:32]);
        validAfter = uint48(bytes6(encoded[32:38]));
        validUntil = uint48(bytes6(encoded[38:44]));
        sponsorNonce = uint256(bytes32(encoded[44:76]));
        verificationGasLimit = uint128(bytes16(paymasterAndData[20:36]));
        postOpGasLimit = uint128(bytes16(paymasterAndData[36:52]));
        signature = encoded[76:141];
    }

    function _authorizationDigest(
        bytes32 operationFieldsHash,
        bytes32 actionHash,
        uint256 maxCost,
        uint128 paymasterVerificationGasLimit,
        uint128 paymasterPostOpGasLimit,
        uint48 validAfter,
        uint48 validUntil,
        uint256 sponsorNonce
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                AUTHORIZATION_TYPEHASH,
                address(entryPoint),
                address(this),
                operationFieldsHash,
                actionHash,
                maxCost,
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit,
                validAfter,
                validUntil,
                sponsorNonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _accountOperationHash(PackedUserOperationV07 calldata userOp) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees
            )
        );
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _withdrawOrCredit(address recipient, uint256 amount) private {
        if (amount == 0) return;
        try entryPoint.withdrawTo(payable(recipient), amount) {} catch {
            pendingRefunds[recipient] += amount;
            pendingRefundTotal += amount;
            emit RefundDeferred(recipient, amount);
        }
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address recovered) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}

struct ExitCall {
    address target;
    uint256 value;
    bytes data;
}
