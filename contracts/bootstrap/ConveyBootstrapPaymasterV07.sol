// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev ABI shape from eth-infinitism/account-abstraction v0.7.0. The field
/// order must stay byte-for-byte compatible with PackedUserOperation.sol.
struct PackedUserOperationV07 {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @dev The one-element Call[] shape encoded in the OKX wallet's user-op payload.
struct BootstrapCallV07 {
    address target;
    uint256 value;
    bytes data;
}

/// @dev The bootstrap paymaster uses only these v0.7 EntryPoint methods.
interface IEntryPointBootstrapV07 {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function withdrawStake(address payable withdrawAddress) external;
}

/// @notice One-operation, X Layer only paymaster for Convey's account gate.
/// @dev This contract is deliberately unusable for product claims. Its sender,
///      factory initCode, and account call are fixed at deployment. The one-use
///      state write means the paymaster must be staked for OKBund safe mode.
contract ConveyBootstrapPaymasterV07 {
    address public constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 public constant XLAYER_CHAIN_ID = 196;
    uint256 public constant MAX_AUTHORIZATION_WINDOW = 300;
    uint256 public constant PAYMASTER_DATA_LENGTH = 109;
    uint256 public constant PAYMASTER_AND_DATA_LENGTH = 20 + 16 + 16 + PAYMASTER_DATA_LENGTH;
    uint256 private constant SIG_VALIDATION_FAILED = 1;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("ConveyBootstrapPaymaster");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes4 private constant OKX_EXECUTE_USER_OP_SELECTOR = 0x8dd7712f;
    bytes32 private constant ACCOUNT_OPERATION_TYPEHASH = keccak256(
        "BootstrapAccountOperation(address sender,uint256 nonce,bytes32 initCodeHash,bytes32 callDataHash,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees)"
    );
    bytes32 private constant PAYMASTER_OPERATION_TYPEHASH = keccak256(
        "BootstrapPaymasterOperation(address entryPoint,uint128 verificationGasLimit,uint128 postOpGasLimit,uint256 maxCost)"
    );
    bytes32 private constant BOOTSTRAP_OPERATION_TYPEHASH = keccak256(
        "BootstrapOperation(bytes32 accountOperationHash,bytes32 paymasterOperationHash)"
    );
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "BootstrapAuthorization(bytes32 operationHash,uint48 validAfter,uint48 validUntil,uint256 sponsorNonce)"
    );

    error WrongChain();
    error InvalidEntryPoint();
    error InvalidOwner();
    error InvalidPolicy();
    error OnlyOwner();
    error OnlyEntryPoint();
    error AuthorizationAlreadyUsed();
    error OperationPolicyMismatch();
    error MalformedPaymasterAndData();
    error PaymasterFieldsMismatch();
    error InvalidSponsorNonce();
    error InvalidValidityWindow();
    error CostCapExceeded();
    error DepositCapExceeded();

    IEntryPointBootstrapV07 public immutable entryPoint;
    address public immutable owner;
    address public immutable verifyingSigner;
    address public immutable bootstrapSender;
    bytes32 public immutable expectedInitCodeHash;
    bytes32 public immutable expectedCallDataHash;
    uint256 public immutable expectedSponsorNonce;
    uint128 public immutable expectedPaymasterVerificationGasLimit;
    uint256 public immutable maxCostCap;
    bool public authorizationConsumed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        address owner_,
        address verifyingSigner_,
        address bootstrapSender_,
        bytes32 expectedInitCodeHash_,
        uint256 expectedSponsorNonce_,
        uint128 expectedPaymasterVerificationGasLimit_,
        uint256 maxCostCap_
    ) {
        if (block.chainid != XLAYER_CHAIN_ID) {
            revert WrongChain();
        }
        if (ENTRY_POINT_V07.code.length == 0) revert InvalidEntryPoint();
        if (owner_ == address(0) || owner_ == verifyingSigner_) revert InvalidOwner();
        if (
            verifyingSigner_ == address(0) || bootstrapSender_ == address(0)
                || expectedInitCodeHash_ == bytes32(0)
                || expectedPaymasterVerificationGasLimit_ == 0 || maxCostCap_ == 0
        ) revert InvalidPolicy();

        entryPoint = IEntryPointBootstrapV07(ENTRY_POINT_V07);
        owner = owner_;
        verifyingSigner = verifyingSigner_;
        bootstrapSender = bootstrapSender_;
        expectedInitCodeHash = expectedInitCodeHash_;
        expectedCallDataHash = keccak256(_harmlessCallData());
        expectedSponsorNonce = expectedSponsorNonce_;
        expectedPaymasterVerificationGasLimit = expectedPaymasterVerificationGasLimit_;
        maxCostCap = maxCostCap_;
    }

    /// @notice Validate the one configured, operator-sponsored account operation.
    /// @dev `userOpHash` is intentionally not signed because it includes this
    ///      paymaster's authorization bytes. All operation-affecting fields are
    ///      instead included directly in the EIP-712 authorization digest.
    function validatePaymasterUserOp(
        PackedUserOperationV07 calldata userOp,
        bytes32,
        /* userOpHash */
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        if (block.chainid != XLAYER_CHAIN_ID) revert WrongChain();
        if (authorizationConsumed) revert AuthorizationAlreadyUsed();
        if (
            userOp.sender != bootstrapSender || keccak256(userOp.initCode) != expectedInitCodeHash
                || keccak256(userOp.callData) != expectedCallDataHash
        ) revert OperationPolicyMismatch();
        if (userOp.paymasterAndData.length != PAYMASTER_AND_DATA_LENGTH) {
            revert MalformedPaymasterAndData();
        }

        address encodedPaymaster = address(bytes20(userOp.paymasterAndData[0:20]));
        uint128 paymasterVerificationGasLimit = uint128(bytes16(userOp.paymasterAndData[20:36]));
        uint128 paymasterPostOpGasLimit = uint128(bytes16(userOp.paymasterAndData[36:52]));
        if (
            encodedPaymaster != address(this)
                || paymasterVerificationGasLimit != expectedPaymasterVerificationGasLimit
                || paymasterPostOpGasLimit != 0
        ) revert PaymasterFieldsMismatch();

        uint48 validAfter = uint48(bytes6(userOp.paymasterAndData[52:58]));
        uint48 validUntil = uint48(bytes6(userOp.paymasterAndData[58:64]));
        uint256 sponsorNonce = uint256(bytes32(userOp.paymasterAndData[64:96]));
        bytes memory signature = userOp.paymasterAndData[96:161];
        if (sponsorNonce != expectedSponsorNonce) revert InvalidSponsorNonce();
        if (
            validUntil == 0 || validUntil <= validAfter
                || uint256(validUntil) - uint256(validAfter) > MAX_AUTHORIZATION_WINDOW
        ) revert InvalidValidityWindow();
        if (maxCost == 0 || maxCost > maxCostCap) revert CostCapExceeded();

        bytes32 digest = _sponsorDigest(
            userOp,
            maxCost,
            validAfter,
            validUntil,
            sponsorNonce,
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        );
        if (_recover(digest, signature) != verifyingSigner) {
            return (bytes(""), SIG_VALIDATION_FAILED);
        }

        // This one-use storage write is why the bootstrap paymaster is staked.
        authorizationConsumed = true;

        // ERC-4337 v0.7 enforces this validity range in EntryPoint. Validation
        // intentionally does not read block.timestamp under ERC-7562 rules.
        validationData = (uint256(validAfter) << 208) | (uint256(validUntil) << 160);
        return (bytes(""), validationData);
    }

    /// @notice The bootstrap returns empty context, so EntryPoint should not need
    ///         to call this hook. It remains implemented and EntryPoint-gated.
    function postOp(uint8, bytes calldata context, uint256, uint256) external view {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        if (context.length != 0) revert InvalidPolicy();
    }

    function sponsorDigest(
        PackedUserOperationV07 calldata userOp,
        uint256 maxCost,
        uint48 validAfter,
        uint48 validUntil,
        uint256 sponsorNonce
    ) external view returns (bytes32) {
        return _sponsorDigest(
            userOp,
            maxCost,
            validAfter,
            validUntil,
            sponsorNonce,
            expectedPaymasterVerificationGasLimit,
            0
        );
    }

    function deposit() external payable onlyOwner {
        // EntryPoint.depositTo(address(this)) is also callable directly by anyone.
        // This guard limits deposits through this function, not the total balance.
        if (entryPoint.balanceOf(address(this)) + msg.value > maxCostCap) {
            revert DepositCapExceeded();
        }
        entryPoint.depositTo{ value: msg.value }(address(this));
    }

    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{ value: msg.value }(unstakeDelaySec);
    }

    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    function withdrawStake(address payable withdrawAddress) external onlyOwner {
        entryPoint.withdrawStake(withdrawAddress);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _sponsorDigest(
        PackedUserOperationV07 calldata userOp,
        uint256 maxCost,
        uint48 validAfter,
        uint48 validUntil,
        uint256 sponsorNonce,
        uint128 paymasterVerificationGasLimit,
        uint128 paymasterPostOpGasLimit
    ) private view returns (bytes32) {
        bytes32 accountOperationHash = keccak256(
            abi.encode(
                ACCOUNT_OPERATION_TYPEHASH,
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees
            )
        );
        bytes32 paymasterOperationHash = keccak256(
            abi.encode(
                PAYMASTER_OPERATION_TYPEHASH,
                address(entryPoint),
                paymasterVerificationGasLimit,
                paymasterPostOpGasLimit,
                maxCost
            )
        );
        bytes32 operationHash = keccak256(
            abi.encode(BOOTSTRAP_OPERATION_TYPEHASH, accountOperationHash, paymasterOperationHash)
        );
        bytes32 structHash = keccak256(
            abi.encode(AUTHORIZATION_TYPEHASH, operationHash, validAfter, validUntil, sponsorNonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
            )
        );
    }

    /// @dev Match only one OKX account call: address(0), zero value, empty data.
    ///      The EntryPoint replaces the executeUserOp selector call with the
    ///      account's executeUserOp(userOp, userOpHash) invocation.
    function _harmlessCallData() private pure returns (bytes memory) {
        BootstrapCallV07[] memory calls = new BootstrapCallV07[](1);
        calls[0] = BootstrapCallV07({ target: address(0), value: 0, data: bytes("") });
        return abi.encodeWithSelector(OKX_EXECUTE_USER_OP_SELECTOR, calls);
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
