// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @dev ABI-compatible subset of the pinned OKX Smart Wallet hook interface.
///      The deployed wallet invokes these callbacks from its own address.
interface IOkxRecurringHook {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function preCheck(Call[] calldata calls, address executor)
        external
        payable
        returns (bytes memory preCheckRet);

    function postCheck(bytes calldata preCheckRet, address executor) external payable;
}

/// @notice Immutable bounds for a narrowly scoped, expiring OKX owner key.
/// @dev Attach one instance to a non-admin OKX owner through its owner settings.
///      The primary admin owner remains responsible for adding and revoking that
///      key with wallet self-calls. This hook does not implement ERC-7579.
contract ConveyRecurringGiftHook is IOkxRecurringHook {
    bytes4 public constant CREATE_GIFT_SELECTOR =
        bytes4(keccak256("createGift(address,uint256,bytes32,bytes32,uint64,bytes32)"));
    uint256 private constant CREATE_GIFT_CALL_LENGTH = 4 + (6 * 32);

    address public immutable wallet;
    address public immutable escrow;
    address public immutable asset;
    uint256 public immutable maxGiftAmount;
    uint256 public immutable maxReserveWei;
    uint256 public immutable totalBudget;
    uint64 public immutable expiresAt;
    uint256 public spent;

    error InvalidConfig();
    error OnlyWallet();
    error AuthorizationExpired();
    error InvalidCallCount();
    error InvalidTarget();
    error InvalidNativeReserve();
    error InvalidGiftCalldata();
    error InvalidAsset();
    error InvalidGiftAmount();
    error InvalidGiftSecret();
    error InvalidGiftExpiry();
    error BudgetExceeded();
    error InvalidPostCheckData();

    event RecurringGiftApproved(
        address indexed executor,
        address indexed asset,
        uint256 amount,
        uint256 nativeReserve,
        uint64 giftExpiry,
        uint256 spentAfter
    );

    modifier onlyWallet() {
        if (msg.sender != wallet) revert OnlyWallet();
        _;
    }

    constructor(
        address wallet_,
        address escrow_,
        address asset_,
        uint256 maxGiftAmount_,
        uint256 maxReserveWei_,
        uint256 totalBudget_,
        uint64 expiresAt_
    ) {
        if (
            wallet_ == address(0) || escrow_ == address(0) || asset_ == address(0)
                || maxGiftAmount_ == 0 || maxReserveWei_ == 0 || totalBudget_ == 0
                || maxGiftAmount_ > totalBudget_ || expiresAt_ <= block.timestamp
        ) revert InvalidConfig();

        wallet = wallet_;
        escrow = escrow_;
        asset = asset_;
        maxGiftAmount = maxGiftAmount_;
        maxReserveWei = maxReserveWei_;
        totalBudget = totalBudget_;
        expiresAt = expiresAt_;
    }

    /// @inheritdoc IOkxRecurringHook
    function preCheck(Call[] calldata calls, address executor)
        external
        payable
        onlyWallet
        returns (bytes memory preCheckRet)
    {
        if (block.timestamp >= expiresAt) revert AuthorizationExpired();
        if (calls.length != 1) revert InvalidCallCount();

        Call calldata call = calls[0];
        if (call.target != escrow) revert InvalidTarget();
        if (call.value == 0 || call.value > maxReserveWei) revert InvalidNativeReserve();
        if (call.data.length != CREATE_GIFT_CALL_LENGTH) revert InvalidGiftCalldata();
        if (bytes4(call.data[0:4]) != CREATE_GIFT_SELECTOR) revert InvalidGiftCalldata();

        (
            address giftAsset,
            uint256 amount,
            bytes32 secretHash,
            bytes32 giftCodeHash,
            uint64 giftExpiry,
            bytes32 giftNoteHash
        ) = abi.decode(call.data[4:], (address, uint256, bytes32, bytes32, uint64, bytes32));

        giftCodeHash;
        giftNoteHash;
        if (giftAsset != asset) revert InvalidAsset();
        if (amount == 0 || amount > maxGiftAmount) revert InvalidGiftAmount();
        if (secretHash == bytes32(0)) revert InvalidGiftSecret();
        if (giftExpiry <= block.timestamp || giftExpiry >= expiresAt) revert InvalidGiftExpiry();
        if (amount > totalBudget - spent) revert BudgetExceeded();

        spent += amount;
        emit RecurringGiftApproved(executor, giftAsset, amount, call.value, giftExpiry, spent);
        return abi.encode(amount, call.value, giftExpiry);
    }

    /// @inheritdoc IOkxRecurringHook
    function postCheck(bytes calldata preCheckRet, address) external payable onlyWallet {
        if (preCheckRet.length != 96) revert InvalidPostCheckData();
        abi.decode(preCheckRet, (uint256, uint256, uint64));
    }
}
