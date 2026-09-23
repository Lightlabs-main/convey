// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PackedUserOperationV07} from "../bootstrap/ConveyBootstrapPaymasterV07.sol";

struct ClaimCallV07 {
    address target;
    uint256 value;
    bytes data;
}

interface IEntryPointClaimV07 {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function withdrawStake(address payable withdrawAddress) external;
}

interface IClaimEscrowState {
    function giftState(uint256 giftId) external view returns (uint8);
}

/// @notice Sender-funded, native-OKB claim sponsorship for Convey gifts.
/// @dev This contract is separate from the one-use bootstrap paymaster. A
///      reserve is bound to one escrow gift and is charged before execution.
contract ConveyClaimPaymasterV07 {
    address public constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 public constant XLAYER_CHAIN_ID = 196;
    uint256 public constant MAX_AUTHORIZATION_WINDOW = 300;
    uint256 public constant CLAIM_PAYMASTER_DATA_LENGTH = 141;
    uint256 public constant PAYMASTER_AND_DATA_LENGTH = 20 + 16 + 16 + CLAIM_PAYMASTER_DATA_LENGTH;

    uint8 private constant OP_SUCCEEDED = 0;
    uint8 private constant OP_REVERTED = 1;
    uint256 private constant SIG_VALIDATION_FAILED = 1;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes4 public constant OKX_EXECUTE_USER_OP_SELECTOR = 0x8dd7712f;
    // forge-lint: disable-next-line(unsafe-typecast): keccak256 is truncated to the ABI selector by definition.
    bytes4 public constant CLAIM_SELECTOR = bytes4(keccak256("claim(uint256,bytes,bytes)"));

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("ConveyClaimPaymaster");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "ClaimAuthorization(address entryPoint,address paymaster,bytes32 accountOperationHash,uint256 giftId,uint256 maxCost,uint128 paymasterVerificationGasLimit,uint128 paymasterPostOpGasLimit,uint48 validAfter,uint48 validUntil,uint256 sponsorNonce)"
    );

    enum ReserveState {
        Open,
        InFlight,
        Closed
    }

    struct GiftReserve {
        uint256 remaining;
        address refundRecipient;
        address account;
        ReserveState state;
    }

    struct ParsedPaymasterData {
        uint256 giftId;
        uint48 validAfter;
        uint48 validUntil;
        uint256 sponsorNonce;
        uint128 verificationGasLimit;
        uint128 postOpGasLimit;
        bytes signature;
    }

    error WrongChain();
    error InvalidEntryPoint();
    error InvalidOwner();
    error InvalidPolicy();
    error OnlyOwner();
    error OnlyEntryPoint();
    error OnlyEscrow();
    error InvalidReserve();
    error ReserveExists();
    error ReserveMissing();
    error ReserveInFlight();
    error ReserveNotInFlight();
    error ReserveAlreadyClosed();
    error InvalidClaimOperation();
    error MalformedPaymasterAndData();
    error InvalidSponsorNonce();
    error SponsorAuthorizationAlreadyUsed();
    error InvalidValidityWindow();
    error CostCapExceeded();
    error InsufficientReserve();
    error InvalidSignature();
    error InvalidRecipient();
    error InsufficientSurplus();
    error InvalidRefund();
    error ReentrantCall();

    event ReserveCreated(uint256 indexed giftId, address indexed refundRecipient, uint256 amount);
    event ClaimAuthorizationReserved(
        uint256 indexed giftId, address indexed account, uint256 maxCost, uint256 sponsorNonce
    );
    event ClaimAuthorizationConsumed(uint256 indexed giftId, address indexed account);
    event ReserveSettled(
        uint256 indexed giftId,
        uint8 mode,
        uint256 actualGasCost,
        uint256 prechargedCost,
        uint256 refunded
    );
    event RefundDeferred(address indexed recipient, uint256 amount);
    event RefundWithdrawn(address indexed recipient, uint256 amount);

    IEntryPointClaimV07 public immutable entryPoint;
    address public immutable owner;
    address public immutable verifyingSigner;
    address public immutable escrow;
    uint256 public immutable minimumReserve;
    uint256 public immutable maxClaimCost;

    uint256 public openReserveTotal;
    uint256 public inFlightTotal;
    uint256 public pendingRefundTotal;
    mapping(uint256 giftId => GiftReserve reserve) private _reserves;
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

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
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
        address escrow_,
        uint256 minimumReserve_,
        uint256 maxClaimCost_
    ) {
        if (block.chainid != XLAYER_CHAIN_ID) revert WrongChain();
        if (ENTRY_POINT_V07.code.length == 0) revert InvalidEntryPoint();
        if (owner_ == address(0) || owner_ == verifyingSigner_) revert InvalidOwner();
        if (verifyingSigner_ == address(0) || escrow_ == address(0)) revert InvalidPolicy();
        if (minimumReserve_ == 0 || maxClaimCost_ == 0 || minimumReserve_ < maxClaimCost_) {
            revert InvalidPolicy();
        }

        entryPoint = IEntryPointClaimV07(ENTRY_POINT_V07);
        owner = owner_;
        verifyingSigner = verifyingSigner_;
        escrow = escrow_;
        minimumReserve = minimumReserve_;
        maxClaimCost = maxClaimCost_;
    }

    function getReserve(uint256 giftId) external view returns (GiftReserve memory) {
        GiftReserve memory reserve = _reserves[giftId];
        if (reserve.refundRecipient == address(0)) revert ReserveMissing();
        return reserve;
    }

    /// @notice Locks the sender's native claim allowance for a new gift.
    function reserveGift(uint256 giftId, address refundRecipient)
        external
        payable
        nonReentrant
        onlyEscrow
    {
        if (giftId == 0 || refundRecipient == address(0) || msg.value < minimumReserve) {
            revert InvalidReserve();
        }
        if (_reserves[giftId].refundRecipient != address(0)) revert ReserveExists();

        entryPoint.depositTo{value: msg.value}(address(this));
        _reserves[giftId] = GiftReserve({
            remaining: msg.value,
            refundRecipient: refundRecipient,
            account: address(0),
            state: ReserveState.Open
        });
        openReserveTotal += msg.value;
        emit ReserveCreated(giftId, refundRecipient, msg.value);
    }

    /// @notice Called by the escrow after the claim transfer, binding the
    ///         successful claim to the UserOperation account authorized above.
    function consumeClaimAuthorization(uint256 giftId, address claimer)
        external
        onlyEscrow
    {
        GiftReserve storage reserve = _reserves[giftId];
        if (reserve.refundRecipient == address(0)) revert ReserveMissing();
        if (reserve.state != ReserveState.InFlight) revert ReserveNotInFlight();
        if (reserve.account != claimer) revert InvalidClaimOperation();
        reserve.state = ReserveState.Closed;
        emit ClaimAuthorizationConsumed(giftId, claimer);
    }

    /// @notice Returns an open gift's unused claim allowance to its sender.
    function releaseForReclaim(uint256 giftId, address refundRecipient)
        external
        nonReentrant
        onlyEscrow
    {
        GiftReserve storage reserve = _reserves[giftId];
        if (reserve.refundRecipient == address(0)) revert ReserveMissing();
        if (reserve.state == ReserveState.InFlight) revert ReserveInFlight();
        if (reserve.state == ReserveState.Closed) revert ReserveAlreadyClosed();
        if (reserve.refundRecipient != refundRecipient) revert InvalidRecipient();

        uint256 amount = reserve.remaining;
        openReserveTotal -= amount;
        delete _reserves[giftId];
        _withdrawOrCredit(refundRecipient, amount);
    }

    /// @notice Validate one scoped, signed claim UserOperation.
    function validatePaymasterUserOp(
        PackedUserOperationV07 calldata userOp,
        bytes32,
        /* userOpHash: intentionally excluded; it contains this signature */
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        if (block.chainid != XLAYER_CHAIN_ID) revert WrongChain();
        if (maxCost == 0 || maxCost > maxClaimCost) revert CostCapExceeded();
        if (userOp.paymasterAndData.length != PAYMASTER_AND_DATA_LENGTH) {
            revert MalformedPaymasterAndData();
        }
        if (address(bytes20(userOp.paymasterAndData[0:20])) != address(this)) {
            revert MalformedPaymasterAndData();
        }

        ParsedPaymasterData memory paymasterData =
            _decodePaymasterData(userOp.paymasterAndData);
        if (
            paymasterData.validUntil == 0 || paymasterData.validUntil <= paymasterData.validAfter
                || uint256(paymasterData.validUntil) - uint256(paymasterData.validAfter)
                    > MAX_AUTHORIZATION_WINDOW
        ) revert InvalidValidityWindow();
        if (usedSponsorNonces[paymasterData.sponsorNonce]) {
            revert SponsorAuthorizationAlreadyUsed();
        }
        if (_claimGiftId(userOp.callData) != paymasterData.giftId) {
            revert InvalidClaimOperation();
        }

        GiftReserve storage reserve = _reserves[paymasterData.giftId];
        if (reserve.refundRecipient == address(0)) revert ReserveMissing();
        if (reserve.state != ReserveState.Open) revert ReserveInFlight();
        if (reserve.remaining < maxCost) revert InsufficientReserve();

        bytes32 digest = _authorizationDigest(
            _accountOperationHash(userOp),
            paymasterData.giftId,
            maxCost,
            paymasterData.verificationGasLimit,
            paymasterData.postOpGasLimit,
            paymasterData.validAfter,
            paymasterData.validUntil,
            paymasterData.sponsorNonce
        );
        if (_recover(digest, paymasterData.signature) != verifyingSigner) {
            return (bytes(""), SIG_VALIDATION_FAILED);
        }

        usedSponsorNonces[paymasterData.sponsorNonce] = true;
        reserve.remaining -= maxCost;
        reserve.account = userOp.sender;
        reserve.state = ReserveState.InFlight;
        openReserveTotal -= maxCost;
        inFlightTotal += maxCost;
        emit ClaimAuthorizationReserved(
            paymasterData.giftId, userOp.sender, maxCost, paymasterData.sponsorNonce
        );

        context = abi.encode(
            paymasterData.giftId,
            maxCost,
            paymasterData.sponsorNonce,
            userOp.sender,
            reserve.refundRecipient
        );
        validationData =
            (uint256(paymasterData.validAfter) << 208) | (uint256(paymasterData.validUntil) << 160);
    }

    /// @notice Reconcile the pre-charge against EntryPoint's actual cost.
    function postOp(
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    ) external nonReentrant onlyEntryPoint {
        (
            uint256 giftId,
            uint256 prechargedCost,
            uint256 sponsorNonce,
            address account,
            address refundRecipient
        ) = abi.decode(context, (uint256, uint256, uint256, address, address));
        GiftReserve storage reserve = _reserves[giftId];
        if (reserve.refundRecipient == address(0)) revert ReserveMissing();
        if (
            (reserve.state != ReserveState.InFlight && reserve.state != ReserveState.Closed)
                || reserve.account != account
        ) {
            revert ReserveNotInFlight();
        }
        if (usedSponsorNonces[sponsorNonce] == false) revert InvalidSponsorNonce();
        if (reserve.refundRecipient != refundRecipient) revert InvalidRecipient();

        bool giftWasClosed = reserve.state == ReserveState.Closed;
        reserve.state = ReserveState.Open;
        reserve.account = address(0);
        inFlightTotal -= prechargedCost;

        uint256 refund = prechargedCost > actualGasCost ? prechargedCost - actualGasCost : 0;

        // The escrow marks a successful claim through consumeClaimAuthorization
        // before EntryPoint calls postOp. Its Closed state must be captured
        // without allowing a second settlement.
        uint8 giftState = _escrowGiftState(giftId);
        if (giftWasClosed || (mode == OP_SUCCEEDED && giftState == 1) || giftState == 2) {
            uint256 remainder = reserve.remaining;
            openReserveTotal -= remainder;
            reserve.remaining = 0;
            refund += remainder;
            delete _reserves[giftId];
        } else {
            reserve.state = ReserveState.Open;
        }

        _withdrawOrCredit(refundRecipient, refund);
        emit ReserveSettled(giftId, mode, actualGasCost, prechargedCost, refund);
    }

    function withdrawPendingRefund(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > pendingRefunds[msg.sender]) revert InvalidRefund();
        pendingRefunds[msg.sender] -= amount;
        pendingRefundTotal -= amount;
        entryPoint.withdrawTo(payable(msg.sender), amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    function withdrawSurplus(address payable recipient, uint256 amount)
        external
        nonReentrant
        onlyOwner
    {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 balance = entryPoint.balanceOf(address(this));
        uint256 locked = openReserveTotal + inFlightTotal + pendingRefundTotal;
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
        uint256 giftId,
        uint256 maxCost,
        uint128 paymasterVerificationGasLimit,
        uint128 paymasterPostOpGasLimit,
        uint48 validAfter,
        uint48 validUntil,
        uint256 sponsorNonce
    ) external view returns (bytes32) {
        return _authorizationDigest(
            operationFieldsHash,
            giftId,
            maxCost,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit,
            validAfter,
            validUntil,
            sponsorNonce
        );
    }

    function accountOperationHash(PackedUserOperationV07 calldata userOp)
        external
        pure
        returns (bytes32)
    {
        return _accountOperationHash(userOp);
    }

    function _decodePaymasterData(bytes calldata paymasterAndData)
        private
        pure
        returns (ParsedPaymasterData memory data)
    {
        bytes calldata encoded = paymasterAndData[52:];
        return ParsedPaymasterData({
            giftId: uint256(bytes32(encoded[0:32])),
            validAfter: uint48(bytes6(encoded[32:38])),
            validUntil: uint48(bytes6(encoded[38:44])),
            sponsorNonce: uint256(bytes32(encoded[44:76])),
            verificationGasLimit: uint128(bytes16(paymasterAndData[20:36])),
            postOpGasLimit: uint128(bytes16(paymasterAndData[36:52])),
            signature: encoded[76:141]
        });
    }

    function _claimGiftId(bytes calldata callData) private view returns (uint256 giftId) {
        if (callData.length < 4 || bytes4(callData[0:4]) != OKX_EXECUTE_USER_OP_SELECTOR) {
            revert InvalidClaimOperation();
        }
        ClaimCallV07[] memory calls = abi.decode(callData[4:], (ClaimCallV07[]));
        if (calls.length != 1) revert InvalidClaimOperation();
        ClaimCallV07 memory call = calls[0];
        if (call.target != escrow || call.value != 0 || call.data.length < 4 + 32 * 3) {
            revert InvalidClaimOperation();
        }
        bytes memory innerCallData = call.data;
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(innerCallData, 0x20))
        }
        if (selector != CLAIM_SELECTOR) revert InvalidClaimOperation();
        assembly ("memory-safe") {
            giftId := mload(add(innerCallData, 0x24))
        }
    }

    function _escrowGiftState(uint256 giftId) private view returns (uint8 state) {
        state = IClaimEscrowState(escrow).giftState(giftId);
    }

    function _authorizationDigest(
        bytes32 operationFieldsHash,
        uint256 giftId,
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
                giftId,
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

    function _accountOperationHash(PackedUserOperationV07 calldata userOp)
        private
        pure
        returns (bytes32)
    {
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
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
            )
        );
    }

    function _withdrawOrCredit(address recipient, uint256 amount) private {
        if (amount == 0) return;
        try entryPoint.withdrawTo(payable(recipient), amount) {
            // EntryPoint owns the actual deposit balance; a successful call is
            // the refund and does not leave native currency in this contract.
        } catch {
            pendingRefunds[recipient] += amount;
            pendingRefundTotal += amount;
            emit RefundDeferred(recipient, amount);
        }
    }

    function _recover(bytes32 digest, bytes memory signature)
        private
        pure
        returns (address recovered)
    {
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
