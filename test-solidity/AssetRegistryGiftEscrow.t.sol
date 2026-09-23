// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    AssetEntry,
    AssetKind,
    AssetRegistry,
    ValuationSource
} from "../contracts/core/AssetRegistry.sol";
import {GiftEscrow} from "../contracts/core/GiftEscrow.sol";

interface VmGiftEscrow {
    function expectRevert(bytes4 revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

/// @dev Deterministic ERC-20 fixture for contract invariants. Live asset
/// certification and live transfer behaviour are verified separately on X Layer.
contract TestERC20 {
    string public constant name = "Test asset fixture";
    string public constant symbol = "TST";
    uint8 public constant decimals = 18;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract AssetRegistryGiftEscrowTest {
    VmGiftEscrow private constant vm =
        VmGiftEscrow(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SENDER = address(0xA11CE);
    address private constant CLAIMER = address(0xB0B);
    address private constant OTHER = address(0xCAFE);
    address private constant VALUATION_REF = address(0x1111);
    address private constant CASH_OUT_ROUTE = address(0x2222);

    AssetRegistry private registry;
    GiftEscrow private escrow;
    TestERC20 private asset;

    function setUp() public {
        asset = new TestERC20();
        registry = new AssetRegistry(address(this));
        escrow = new GiftEscrow(registry);
        registry.registerAsset(_assetEntry(address(asset), true, true));

        asset.mint(SENDER, 1_000 ether);
        vm.prank(SENDER);
        asset.approve(address(escrow), type(uint256).max);
    }

    function testOnlyCertifiedAndEnabledAssetsAreGiftable() public {
        require(registry.assetExists(address(asset)), "asset was not registered");
        require(registry.isGiftable(address(asset)), "asset is not giftable");

        registry.setEnabled(address(asset), false);
        require(!registry.isGiftable(address(asset)), "disabled asset remained giftable");

        registry.setCertified(address(asset), false);
        vm.expectRevert(AssetRegistry.CannotEnableUncertifiedAsset.selector);
        registry.setEnabled(address(asset), true);

        registry.setCertified(address(asset), true);
        registry.setEnabled(address(asset), true);
        require(registry.isGiftable(address(asset)), "re-certified asset was not enabled");
    }

    function testRegistryRejectsEnabledUncertifiedAndInvalidWrapperEntries() public {
        AssetEntry memory uncertified = _assetEntry(address(OTHER), false, true);
        uncertified.certified = false;
        vm.expectRevert(AssetRegistry.CannotEnableUncertifiedAsset.selector);
        registry.registerAsset(uncertified);

        AssetEntry memory missingUnderlying = _assetEntry(address(OTHER), true, false);
        vm.expectRevert(AssetRegistry.InvalidAsset.selector);
        registry.registerAsset(missingUnderlying);

        AssetEntry memory wrongUnwrappedUnderlying = _assetEntry(address(OTHER), false, false);
        wrongUnwrappedUnderlying.underlying = address(VALUATION_REF);
        vm.expectRevert(AssetRegistry.InvalidAsset.selector);
        registry.registerAsset(wrongUnwrappedUnderlying);
    }

    function testRegistryMutationsAreOwnerOnly() public {
        vm.expectRevert(AssetRegistry.NotOwner.selector);
        vm.prank(OTHER);
        registry.setEnabled(address(asset), false);

        vm.expectRevert(AssetRegistry.NotOwner.selector);
        vm.prank(OTHER);
        registry.setCertified(address(asset), false);
    }

    function testConstructorRejectsZeroRegistry() public {
        vm.expectRevert(GiftEscrow.InvalidRegistry.selector);
        new GiftEscrow(AssetRegistry(address(0)));
    }

    function testCreateClaimPaysOnlyTheAccountThatSuppliesTheSecret() public {
        bytes memory secret = bytes("claim-secret");
        uint256 amount = 100 ether;
        uint256 giftId = _createGift(secret, bytes(""), 0);

        require(asset.balanceOf(address(escrow)) == amount, "escrow was not funded");
        require(asset.balanceOf(SENDER) == 900 ether, "sender balance changed unexpectedly");

        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, bytes(""));

        GiftEscrow.Gift memory gift = escrow.getGift(giftId);
        require(uint8(gift.state) == uint8(GiftEscrow.GiftState.Claimed), "gift was not claimed");
        require(asset.balanceOf(CLAIMER) == amount, "claimer did not receive the gift");
        require(asset.balanceOf(OTHER) == 0, "unrelated account received funds");
        require(asset.balanceOf(address(escrow)) == 0, "escrow retained claimed funds");
    }

    function testWrongSecretDoesNotChangeGiftStateOrBalances() public {
        bytes memory secret = bytes("claim-secret");
        uint256 giftId = _createGift(secret, bytes(""), 0);

        vm.expectRevert(GiftEscrow.InvalidSecret.selector);
        vm.prank(CLAIMER);
        escrow.claim(giftId, bytes("wrong-secret"), bytes(""));

        GiftEscrow.Gift memory gift = escrow.getGift(giftId);
        require(uint8(gift.state) == uint8(GiftEscrow.GiftState.Open), "wrong secret changed state");
        require(asset.balanceOf(address(escrow)) == 100 ether, "wrong secret moved funds");
    }

    function testCodeHashIsRequiredWhenConfigured() public {
        bytes memory secret = bytes("claim-secret");
        bytes memory code = bytes("4471");
        uint256 giftId = _createGift(secret, code, 0);

        vm.expectRevert(GiftEscrow.InvalidCode.selector);
        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, bytes(""));

        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, code);
        require(asset.balanceOf(CLAIMER) == 100 ether, "coded claim did not pay claimer");
    }

    function testClaimCanOnlyHappenOnceAndReclaimCannotFollowClaim() public {
        bytes memory secret = bytes("claim-secret");
        uint256 giftId = _createGift(secret, bytes(""), 0);

        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, bytes(""));

        vm.expectRevert(GiftEscrow.GiftNotOpen.selector);
        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, bytes(""));

        vm.expectRevert(GiftEscrow.GiftNotOpen.selector);
        vm.prank(SENDER);
        escrow.reclaim(giftId);
    }

    function testSenderCanReclaimAnOpenGiftBeforeExpiry() public {
        bytes memory secret = bytes("claim-secret");
        uint256 giftId = _createGift(secret, bytes(""), uint64(block.timestamp + 1 days));

        vm.prank(SENDER);
        escrow.reclaim(giftId);

        GiftEscrow.Gift memory gift = escrow.getGift(giftId);
        require(uint8(gift.state) == uint8(GiftEscrow.GiftState.Reclaimed), "gift was not reclaimed");
        require(asset.balanceOf(SENDER) == 1_000 ether, "sender was not refunded");
        require(asset.balanceOf(address(escrow)) == 0, "reclaimed funds remained escrowed");
    }

    function testOnlySenderCanReclaim() public {
        uint256 giftId = _createGift(bytes("claim-secret"), bytes(""), 0);

        vm.expectRevert(GiftEscrow.NotSender.selector);
        vm.prank(OTHER);
        escrow.reclaim(giftId);

        require(asset.balanceOf(address(escrow)) == 100 ether, "unauthorized reclaim moved funds");
    }

    function testExpiredGiftRejectsClaimButAllowsSenderRefund() public {
        bytes memory secret = bytes("claim-secret");
        uint256 expiry = block.timestamp + 1 days;
        uint256 giftId = _createGift(secret, bytes(""), uint64(expiry));

        vm.warp(expiry);
        vm.expectRevert(GiftEscrow.GiftExpired.selector);
        vm.prank(CLAIMER);
        escrow.claim(giftId, secret, bytes(""));

        vm.prank(SENDER);
        escrow.reclaim(giftId);
        require(asset.balanceOf(SENDER) == 1_000 ether, "expired gift was not refunded");
    }

    function testCreateRejectsInvalidInputs() public {
        vm.expectRevert(GiftEscrow.InvalidAmount.selector);
        vm.prank(SENDER);
        escrow.createGift(address(asset), 0, keccak256(bytes("secret")), bytes32(0), 0, bytes32(0));

        vm.expectRevert(GiftEscrow.InvalidSecretHash.selector);
        vm.prank(SENDER);
        escrow.createGift(address(asset), 100 ether, bytes32(0), bytes32(0), 0, bytes32(0));

        vm.expectRevert(GiftEscrow.InvalidExpiry.selector);
        vm.prank(SENDER);
        escrow.createGift(
            address(asset),
            100 ether,
            keccak256(bytes("secret")),
            bytes32(0),
            uint64(block.timestamp),
            bytes32(0)
        );

        registry.setEnabled(address(asset), false);
        vm.expectRevert(GiftEscrow.AssetNotGiftable.selector);
        vm.prank(SENDER);
        escrow.createGift(address(asset), 100 ether, keccak256(bytes("secret")), bytes32(0), 0, bytes32(0));
    }

    function _createGift(bytes memory secret, bytes memory code, uint64 expiry)
        private
        returns (uint256 giftId)
    {
        bytes32 codeHash = code.length == 0 ? bytes32(0) : keccak256(code);
        vm.prank(SENDER);
        giftId = escrow.createGift(
            address(asset), 100 ether, keccak256(secret), codeHash, expiry, bytes32(0)
        );
    }

    function _assetEntry(address token, bool certified, bool enabled)
        private
        pure
        returns (AssetEntry memory)
    {
        return AssetEntry({
            token: token,
            kind: AssetKind.EQUITY,
            decimals: 18,
            isWrapped: false,
            underlying: token,
            valuation: ValuationSource.ISSUER_API,
            valuationRef: address(0),
            cashOutRoute: CASH_OUT_ROUTE,
            certified: certified,
            enabled: enabled,
            riskTag: "economic-exposure"
        });
    }
}
