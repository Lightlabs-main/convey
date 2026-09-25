// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AssetRegistry} from "./AssetRegistry.sol";

interface IERC20Gift {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IClaimGasPaymaster {
    function reserveGift(uint256 giftId, address refundRecipient) external payable;
    function consumeClaimAuthorization(uint256 giftId, address claimer) external;
    function releaseForReclaim(uint256 giftId, address refundRecipient) external;
}

/// @notice A single bearer gift backed by a certified registry asset.
/// @dev The claimer is always msg.sender. The link secret is a one-time
///      secp256k1 key; the escrow stores only its address. A claim must carry
///      that key's signature over (chainId, escrow, giftId, claimer), so a
///      claim observed in a mempool, bundler, or failed attempt cannot be
///      replayed by anyone else to redirect the gift.
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
        address claimKey;
        bytes32 codeHash;
        uint64 expiry;
        bytes32 noteHash;
        GiftState state;
    }

    error AssetNotGiftable();
    error InvalidAmount();
    error InvalidClaimKey();
    error InvalidExpiry();
    error UnknownGift();
    error GiftNotOpen();
    error NotSender();
    error GiftExpired();
    error InvalidClaimSignature();
    error InvalidCode();
    error InvalidRegistry();
    error InvalidClaimPaymaster();
    error InvalidClaimGasReserve();
    error ReentrantCall();
    error TokenTransferFailed();
    error TokenAmountMismatch();

    event GiftCreated(
        uint256 indexed giftId,
        address indexed sender,
        address indexed asset,
        uint256 amount,
        address claimKey,
        bytes32 codeHash,
        uint64 expiry,
        bytes32 noteHash
    );
    event GiftClaimed(uint256 indexed giftId, address indexed claimer, uint256 amount);
    event GiftReclaimed(uint256 indexed giftId, address indexed sender, uint256 amount);

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("ConveyClaim(uint256 chainId,address escrow,uint256 giftId,address claimer)");
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    AssetRegistry public immutable registry;
    IClaimGasPaymaster public immutable claimPaymaster;
    uint256 public nextGiftId = 1;
    mapping(uint256 giftId => Gift gift) private _gifts;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(AssetRegistry registry_, IClaimGasPaymaster claimPaymaster_) {
        if (address(registry_) == address(0)) revert InvalidRegistry();
        if (address(claimPaymaster_) == address(0)) revert InvalidClaimPaymaster();
        registry = registry_;
        claimPaymaster = claimPaymaster_;
    }

    function createGift(
        address asset,
        uint256 amount,
        address claimKey,
        bytes32 codeHash,
        uint64 expiry,
        bytes32 noteHash
    ) external payable nonReentrant returns (uint256 giftId) {
        if (!registry.isGiftable(asset)) revert AssetNotGiftable();
        if (amount == 0) revert InvalidAmount();
        if (claimKey == address(0)) revert InvalidClaimKey();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();
        if (msg.value == 0) revert InvalidClaimGasReserve();

        _pullExact(asset, msg.sender, amount);

        giftId = nextGiftId;
        claimPaymaster.reserveGift{value: msg.value}(giftId, msg.sender);
        nextGiftId = giftId + 1;
        _gifts[giftId] = Gift({
            sender: msg.sender,
            asset: asset,
            amount: amount,
            claimKey: claimKey,
            codeHash: codeHash,
            expiry: expiry,
            noteHash: noteHash,
            state: GiftState.Open
        });
        emit GiftCreated(giftId, msg.sender, asset, amount, claimKey, codeHash, expiry, noteHash);
    }

    function claim(uint256 giftId, bytes calldata claimSignature, bytes calldata code)
        external
        nonReentrant
    {
        Gift storage gift = _openGift(giftId);
        if (gift.expiry != 0 && block.timestamp >= gift.expiry) revert GiftExpired();
        if (_recoverClaimSigner(claimDigest(giftId, msg.sender), claimSignature) != gift.claimKey) {
            revert InvalidClaimSignature();
        }
        if (gift.codeHash == bytes32(0)) {
            if (code.length != 0) revert InvalidCode();
        } else if (code.length == 0 || keccak256(code) != gift.codeHash) {
            revert InvalidCode();
        }

        gift.state = GiftState.Claimed;
        _pushExact(gift.asset, msg.sender, gift.amount);
        claimPaymaster.consumeClaimAuthorization(giftId, msg.sender);
        emit GiftClaimed(giftId, msg.sender, gift.amount);
    }

    function reclaim(uint256 giftId) external nonReentrant {
        Gift storage gift = _openGift(giftId);
        if (gift.sender != msg.sender) revert NotSender();

        gift.state = GiftState.Reclaimed;
        _pushExact(gift.asset, msg.sender, gift.amount);
        claimPaymaster.releaseForReclaim(giftId, msg.sender);
        emit GiftReclaimed(giftId, msg.sender, gift.amount);
    }

    /// @notice Digest the one-time claim key signs to bind a gift to a claimer.
    function claimDigest(uint256 giftId, address claimer) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_TYPEHASH, block.chainid, address(this), giftId, claimer));
    }

    function getGift(uint256 giftId) external view returns (Gift memory) {
        Gift memory gift = _gifts[giftId];
        if (gift.sender == address(0)) revert UnknownGift();
        return gift;
    }

    function giftState(uint256 giftId) external view returns (GiftState) {
        Gift memory gift = _gifts[giftId];
        if (gift.sender == address(0)) revert UnknownGift();
        return gift.state;
    }

    function _openGift(uint256 giftId) private view returns (Gift storage gift) {
        gift = _gifts[giftId];
        if (gift.sender == address(0)) revert UnknownGift();
        if (gift.state != GiftState.Open) revert GiftNotOpen();
    }

    function _recoverClaimSigner(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address signer)
    {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > SECP256K1_HALF_ORDER) return address(0);
        signer = ecrecover(digest, v, r, s);
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
