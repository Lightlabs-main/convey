// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AssetRegistry} from "./AssetRegistry.sol";

interface IERC20Gift {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice A single bearer gift backed by a certified registry asset.
/// @dev The claimer is always msg.sender. There is no arbitrary recipient
///      parameter that a relayer or copied link can redirect.
contract GiftEscrow {
    enum GiftState {
        Open,
        Claimed,
        Reclaimed
    }

    struct Gift {
        address sender;
        address asset;
        uint256 amount;
        bytes32 secretHash;
        bytes32 codeHash;
        uint64 expiry;
        bytes32 noteHash;
        GiftState state;
    }

    error AssetNotGiftable();
    error InvalidAmount();
    error InvalidSecretHash();
    error InvalidExpiry();
    error UnknownGift();
    error GiftNotOpen();
    error NotSender();
    error GiftExpired();
    error InvalidSecret();
    error InvalidCode();
    error InvalidRegistry();
    error ReentrantCall();
    error TokenTransferFailed();
    error TokenAmountMismatch();

    event GiftCreated(
        uint256 indexed giftId,
        address indexed sender,
        address indexed asset,
        uint256 amount,
        bytes32 secretHash,
        bytes32 codeHash,
        uint64 expiry,
        bytes32 noteHash
    );
    event GiftClaimed(uint256 indexed giftId, address indexed claimer, uint256 amount);
    event GiftReclaimed(uint256 indexed giftId, address indexed sender, uint256 amount);

    AssetRegistry public immutable registry;
    uint256 public nextGiftId = 1;
    mapping(uint256 giftId => Gift gift) private _gifts;
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

    function createGift(
        address asset,
        uint256 amount,
        bytes32 secretHash,
        bytes32 codeHash,
        uint64 expiry,
        bytes32 noteHash
    ) external nonReentrant returns (uint256 giftId) {
        if (!registry.isGiftable(asset)) revert AssetNotGiftable();
        if (amount == 0) revert InvalidAmount();
        if (secretHash == bytes32(0)) revert InvalidSecretHash();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();

        _pullExact(asset, msg.sender, amount);

        giftId = nextGiftId++;
        _gifts[giftId] = Gift({
            sender: msg.sender,
            asset: asset,
            amount: amount,
            secretHash: secretHash,
            codeHash: codeHash,
            expiry: expiry,
            noteHash: noteHash,
            state: GiftState.Open
        });
        emit GiftCreated(giftId, msg.sender, asset, amount, secretHash, codeHash, expiry, noteHash);
    }

    function claim(uint256 giftId, bytes calldata secret, bytes calldata code)
        external
        nonReentrant
    {
        Gift storage gift = _openGift(giftId);
        if (gift.expiry != 0 && block.timestamp >= gift.expiry) revert GiftExpired();
        if (secret.length == 0 || keccak256(secret) != gift.secretHash) revert InvalidSecret();
        if (gift.codeHash == bytes32(0)) {
            if (code.length != 0) revert InvalidCode();
        } else if (code.length == 0 || keccak256(code) != gift.codeHash) {
            revert InvalidCode();
        }

        gift.state = GiftState.Claimed;
        _pushExact(gift.asset, msg.sender, gift.amount);
        emit GiftClaimed(giftId, msg.sender, gift.amount);
    }

    function reclaim(uint256 giftId) external nonReentrant {
        Gift storage gift = _openGift(giftId);
        if (gift.sender != msg.sender) revert NotSender();

        gift.state = GiftState.Reclaimed;
        _pushExact(gift.asset, msg.sender, gift.amount);
        emit GiftReclaimed(giftId, msg.sender, gift.amount);
    }

    function getGift(uint256 giftId) external view returns (Gift memory) {
        Gift memory gift = _gifts[giftId];
        if (gift.sender == address(0)) revert UnknownGift();
        return gift;
    }

    function _openGift(uint256 giftId) private view returns (Gift storage gift) {
        gift = _gifts[giftId];
        if (gift.sender == address(0)) revert UnknownGift();
        if (gift.state != GiftState.Open) revert GiftNotOpen();
    }

    function _pullExact(address asset, address from, uint256 amount) private {
        IERC20Gift token = IERC20Gift(asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        _callToken(asset, abi.encodeCall(IERC20Gift.transferFrom, (from, address(this), amount)));
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert TokenAmountMismatch();
        }
    }

    function _pushExact(address asset, address to, uint256 amount) private {
        IERC20Gift token = IERC20Gift(asset);
        uint256 beforeBalance = token.balanceOf(to);
        _callToken(asset, abi.encodeCall(IERC20Gift.transfer, (to, amount)));
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
