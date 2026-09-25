// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { AssetRegistry } from "./AssetRegistry.sol";

interface IERC20Drop {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice A pre-funded multi-claim distribution of one certified asset.
/// @dev Each account address can claim at most one slot. The contract does not
///      use tx.origin, so a smart-account address is the claim identity.
contract DropEscrow {
    struct Drop {
        address sender;
        address asset;
        uint256 slotAmount;
        uint256 slotCount;
        uint256 remainingSlots;
        uint64 expiry;
        bytes32 noteHash;
        bool reclaimed;
    }

    error AssetNotGiftable();
    error InvalidAmount();
    error InvalidSlotCount();
    error InvalidExpiry();
    error InvalidRegistry();
    error UnknownDrop();
    error DropExpired();
    error DropExhausted();
    error DropAlreadyReclaimed();
    error AlreadyClaimed();
    error NotSender();
    error DropNotExpired();
    error NothingToReclaim();
    error ReentrantCall();
    error TokenTransferFailed();
    error TokenAmountMismatch();
    error AmountOverflow();

    event DropCreated(
        uint256 indexed dropId,
        address indexed sender,
        address indexed asset,
        uint256 slotAmount,
        uint256 slotCount,
        uint64 expiry,
        bytes32 noteHash
    );
    event DropClaimed(
        uint256 indexed dropId, address indexed account, uint256 amount, uint256 remainingSlots
    );
    event DropReclaimed(
        uint256 indexed dropId, address indexed sender, uint256 amount, uint256 remainingSlots
    );

    AssetRegistry public immutable registry;
    uint256 public nextDropId = 1;
    mapping(uint256 dropId => Drop drop) private _drops;
    mapping(uint256 dropId => mapping(address account => bool claimed)) public claimedBy;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(AssetRegistry registry_) {
        if (address(registry_) == address(0)) revert InvalidRegistry();
        registry = registry_;
    }

    /// @notice Pre-fund every slot before any account can claim.
    /// @dev Drops require an expiry so the sender always has a deterministic
    ///      recovery point for unclaimed slots.
    function createDrop(
        address asset,
        uint256 slotAmount,
        uint256 slotCount,
        uint64 expiry,
        bytes32 noteHash
    ) external nonReentrant returns (uint256 dropId) {
        if (!registry.isGiftable(asset)) revert AssetNotGiftable();
        if (slotAmount == 0) revert InvalidAmount();
        if (slotCount == 0) revert InvalidSlotCount();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (slotAmount > type(uint256).max / slotCount) revert AmountOverflow();

        uint256 totalAmount = slotAmount * slotCount;
        _pullExact(asset, msg.sender, totalAmount);

        dropId = nextDropId++;
        _drops[dropId] = Drop({
            sender: msg.sender,
            asset: asset,
            slotAmount: slotAmount,
            slotCount: slotCount,
            remainingSlots: slotCount,
            expiry: expiry,
            noteHash: noteHash,
            reclaimed: false
        });
        emit DropCreated(dropId, msg.sender, asset, slotAmount, slotCount, expiry, noteHash);
    }

    /// @notice Release exactly one slot to the calling account.
    function claim(uint256 dropId) external nonReentrant {
        Drop storage drop = _drop(dropId);
        if (drop.reclaimed) revert DropAlreadyReclaimed();
        if (block.timestamp >= drop.expiry) revert DropExpired();
        if (drop.remainingSlots == 0) revert DropExhausted();
        if (claimedBy[dropId][msg.sender]) revert AlreadyClaimed();

        claimedBy[dropId][msg.sender] = true;
        drop.remainingSlots -= 1;
        _pushExact(drop.asset, msg.sender, drop.slotAmount);
        emit DropClaimed(dropId, msg.sender, drop.slotAmount, drop.remainingSlots);
    }

    /// @notice Return all unclaimed slots to the sender after expiry.
    function reclaim(uint256 dropId) external nonReentrant {
        Drop storage drop = _drop(dropId);
        if (drop.sender != msg.sender) revert NotSender();
        if (block.timestamp < drop.expiry) revert DropNotExpired();
        if (drop.reclaimed) revert DropAlreadyReclaimed();
        if (drop.remainingSlots == 0) revert NothingToReclaim();

        uint256 remainingSlots = drop.remainingSlots;
        uint256 amount = drop.slotAmount * remainingSlots;
        drop.remainingSlots = 0;
        drop.reclaimed = true;
        _pushExact(drop.asset, msg.sender, amount);
        emit DropReclaimed(dropId, msg.sender, amount, remainingSlots);
    }

    function getDrop(uint256 dropId) external view returns (Drop memory) {
        return _drop(dropId);
    }

    function _drop(uint256 dropId) private view returns (Drop storage drop) {
        drop = _drops[dropId];
        if (drop.sender == address(0)) revert UnknownDrop();
    }

    function _pullExact(address asset, address from, uint256 amount) private {
        IERC20Drop token = IERC20Drop(asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        _callToken(asset, abi.encodeCall(IERC20Drop.transferFrom, (from, address(this), amount)));
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert TokenAmountMismatch();
        }
    }

    function _pushExact(address asset, address to, uint256 amount) private {
        IERC20Drop token = IERC20Drop(asset);
        uint256 beforeBalance = token.balanceOf(to);
        _callToken(asset, abi.encodeCall(IERC20Drop.transfer, (to, amount)));
        uint256 afterBalance = token.balanceOf(to);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert TokenAmountMismatch();
        }
    }

    function _callToken(address asset, bytes memory callData) private {
        (bool success, bytes memory result) = asset.call(callData);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }
    }
}
