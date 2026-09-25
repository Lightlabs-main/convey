// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    AssetEntry,
    AssetKind,
    AssetRegistry,
    ValuationSource
} from "../contracts/core/AssetRegistry.sol";
import { DropEscrow } from "../contracts/core/DropEscrow.sol";

interface VmDropEscrow {
    function expectRevert(bytes4 revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

/// @dev Deterministic ERC-20 fixture for the drop escrow invariants.
contract DropTestERC20 {
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

contract DropEscrowTest {
    VmDropEscrow private constant vm =
        VmDropEscrow(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SENDER = address(0xA11CE);
    address private constant CLAIMER = address(0xB0B);
    address private constant OTHER = address(0xCAFE);
    address private constant THIRD = address(0xD00D);
    address private constant CASH_OUT_ROUTE = address(0x2222);

    AssetRegistry private registry;
    DropEscrow private dropEscrow;
    DropTestERC20 private asset;

    function setUp() public {
        asset = new DropTestERC20();
        registry = new AssetRegistry(address(this));
        dropEscrow = new DropEscrow(registry);
        registry.registerAsset(_assetEntry(address(asset)));

        asset.mint(SENDER, 1_000 ether);
        vm.prank(SENDER);
        asset.approve(address(dropEscrow), type(uint256).max);
    }

    function testCreatePrefundsEverySlotAndEachAccountClaimsOnce() public {
        uint256 dropId = _createDrop(100 ether, 3, uint64(block.timestamp + 1 days));
        require(asset.balanceOf(address(dropEscrow)) == 300 ether, "drop was not fully funded");

        DropEscrow.Drop memory drop = dropEscrow.getDrop(dropId);
        require(drop.slotAmount == 100 ether, "slot amount mismatch");
        require(drop.slotCount == 3, "slot count mismatch");
        require(drop.remainingSlots == 3, "remaining slots mismatch");

        vm.prank(CLAIMER);
        dropEscrow.claim(dropId);
        require(asset.balanceOf(CLAIMER) == 100 ether, "first claim amount mismatch");
        require(dropEscrow.claimedBy(dropId, CLAIMER), "claim identity was not recorded");

        vm.expectRevert(DropEscrow.AlreadyClaimed.selector);
        vm.prank(CLAIMER);
        dropEscrow.claim(dropId);

        vm.prank(OTHER);
        dropEscrow.claim(dropId);
        vm.prank(THIRD);
        dropEscrow.claim(dropId);

        require(asset.balanceOf(OTHER) == 100 ether, "second account amount mismatch");
        require(asset.balanceOf(THIRD) == 100 ether, "third account amount mismatch");
        drop = dropEscrow.getDrop(dropId);
        require(drop.remainingSlots == 0, "drop was not exhausted");

        vm.expectRevert(DropEscrow.DropExhausted.selector);
        vm.prank(address(0xE0E));
        dropEscrow.claim(dropId);
    }

    function testExpiredDropReturnsOnlyUnclaimedSlotsToSender() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 dropId = _createDrop(100 ether, 3, expiry);

        vm.prank(CLAIMER);
        dropEscrow.claim(dropId);
        require(asset.balanceOf(address(dropEscrow)) == 200 ether, "claimed slot remained escrowed");

        vm.warp(expiry);
        vm.expectRevert(DropEscrow.DropExpired.selector);
        vm.prank(OTHER);
        dropEscrow.claim(dropId);

        vm.expectRevert(DropEscrow.NotSender.selector);
        vm.prank(OTHER);
        dropEscrow.reclaim(dropId);

        vm.prank(SENDER);
        dropEscrow.reclaim(dropId);
        require(asset.balanceOf(SENDER) == 900 ether, "sender did not receive remaining slots");
        require(asset.balanceOf(address(dropEscrow)) == 0, "unclaimed slots remained escrowed");

        DropEscrow.Drop memory drop = dropEscrow.getDrop(dropId);
        require(drop.remainingSlots == 0, "remaining slots were not cleared");
        require(drop.reclaimed, "drop was not marked reclaimed");

        vm.expectRevert(DropEscrow.DropAlreadyReclaimed.selector);
        vm.prank(SENDER);
        dropEscrow.reclaim(dropId);
    }

    function testReclaimRequiresExpiry() public {
        uint256 dropId = _createDrop(100 ether, 1, uint64(block.timestamp + 1 days));

        vm.expectRevert(DropEscrow.DropNotExpired.selector);
        vm.prank(SENDER);
        dropEscrow.reclaim(dropId);
    }

    function testCreationRejectsInvalidDrops() public {
        vm.expectRevert(DropEscrow.InvalidAmount.selector);
        vm.prank(SENDER);
        dropEscrow.createDrop(address(asset), 0, 1, uint64(block.timestamp + 1 days), bytes32(0));

        vm.expectRevert(DropEscrow.InvalidSlotCount.selector);
        vm.prank(SENDER);
        dropEscrow.createDrop(
            address(asset), 1 ether, 0, uint64(block.timestamp + 1 days), bytes32(0)
        );

        vm.expectRevert(DropEscrow.InvalidExpiry.selector);
        vm.prank(SENDER);
        dropEscrow.createDrop(address(asset), 1 ether, 1, uint64(block.timestamp), bytes32(0));

        vm.expectRevert(DropEscrow.AmountOverflow.selector);
        vm.prank(SENDER);
        dropEscrow.createDrop(
            address(asset), type(uint256).max, 2, uint64(block.timestamp + 1 days), bytes32(0)
        );

        registry.setEnabled(address(asset), false);
        vm.expectRevert(DropEscrow.AssetNotGiftable.selector);
        vm.prank(SENDER);
        dropEscrow.createDrop(
            address(asset), 1 ether, 1, uint64(block.timestamp + 1 days), bytes32(0)
        );
    }

    function _createDrop(uint256 slotAmount, uint256 slotCount, uint64 expiry)
        private
        returns (uint256 dropId)
    {
        vm.prank(SENDER);
        dropId = dropEscrow.createDrop(address(asset), slotAmount, slotCount, expiry, bytes32(0));
    }

    function _assetEntry(address token) private pure returns (AssetEntry memory) {
        return AssetEntry({
            token: token,
            kind: AssetKind.EQUITY,
            decimals: 18,
            isWrapped: false,
            underlying: token,
            valuation: ValuationSource.ISSUER_API,
            valuationRef: address(0),
            cashOutRoute: CASH_OUT_ROUTE,
            certified: true,
            enabled: true,
            riskTag: "economic-exposure"
        });
    }
}
