// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    ConveyRecurringGiftHook,
    IOkxRecurringHook
} from "../contracts/recurring/ConveyRecurringGiftHook.sol";

interface VmRecurringGiftHook {
    function expectRevert(bytes4 revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockRecurringWallet {
    error TargetFailed();

    function execute(
        ConveyRecurringGiftHook hook,
        IOkxRecurringHook.Call[] calldata calls,
        bool failAfterPreCheck
    ) external returns (bytes memory preCheckRet) {
        preCheckRet = hook.preCheck(calls, msg.sender);
        if (failAfterPreCheck) revert TargetFailed();
        hook.postCheck(preCheckRet, msg.sender);
    }
}

contract ConveyRecurringGiftHookTest {
    VmRecurringGiftHook private constant vm =
        VmRecurringGiftHook(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ESCROW = address(0xE5C0A);
    address private constant ASSET = address(0xA55E7);
    address private constant OUTSIDER = address(0xCAFE);
    uint256 private constant MAX_GIFT = 100 ether;
    uint256 private constant MAX_RESERVE = 0.00002 ether;
    uint256 private constant TOTAL_BUDGET = 250 ether;

    MockRecurringWallet private wallet;
    ConveyRecurringGiftHook private hook;
    uint64 private expiry;

    function setUp() public {
        wallet = new MockRecurringWallet();
        expiry = uint64(block.timestamp + 7 days);
        hook = new ConveyRecurringGiftHook(
            address(wallet), ESCROW, ASSET, MAX_GIFT, MAX_RESERVE, TOTAL_BUDGET, expiry
        );
    }

    function testValidGiftConsumesBoundedBudgetAndRunsPostCheck() public {
        IOkxRecurringHook.Call[] memory calls = new IOkxRecurringHook.Call[](1);
        calls[0] = _giftCall(75 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));

        wallet.execute(hook, calls, false);

        require(hook.spent() == 75 ether, "budget was not consumed");
    }

    function testPolicyRejectsWrongTargetAssetSelectorAndBatchShape() public {
        IOkxRecurringHook.Call[] memory calls = new IOkxRecurringHook.Call[](1);
        calls[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));

        calls[0].target = address(0x1234);
        vm.expectRevert(ConveyRecurringGiftHook.InvalidTarget.selector);
        wallet.execute(hook, calls, false);

        calls[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        calls[0].data = abi.encodeWithSignature(
            "createGift(address,uint256,bytes32,bytes32,uint64,bytes32)",
            address(0xBEEF),
            1 ether,
            keccak256(bytes("secret")),
            bytes32(0),
            uint64(block.timestamp + 1 days),
            bytes32(0)
        );
        vm.expectRevert(ConveyRecurringGiftHook.InvalidAsset.selector);
        wallet.execute(hook, calls, false);

        calls[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        calls[0].data = hex"12345678";
        vm.expectRevert(ConveyRecurringGiftHook.InvalidGiftCalldata.selector);
        wallet.execute(hook, calls, false);

        IOkxRecurringHook.Call[] memory batch = new IOkxRecurringHook.Call[](2);
        batch[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        batch[1] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        vm.expectRevert(ConveyRecurringGiftHook.InvalidCallCount.selector);
        wallet.execute(hook, batch, false);
    }

    function testPolicyRejectsReserveAmountGiftCapBudgetAndExpiryViolations() public {
        IOkxRecurringHook.Call[] memory calls = new IOkxRecurringHook.Call[](1);
        calls[0] = _giftCall(1 ether, MAX_RESERVE + 1, uint64(block.timestamp + 1 days));
        vm.expectRevert(ConveyRecurringGiftHook.InvalidNativeReserve.selector);
        wallet.execute(hook, calls, false);

        calls[0] = _giftCall(MAX_GIFT + 1, MAX_RESERVE, uint64(block.timestamp + 1 days));
        vm.expectRevert(ConveyRecurringGiftHook.InvalidGiftAmount.selector);
        wallet.execute(hook, calls, false);

        calls[0] = _giftCall(1 ether, MAX_RESERVE, expiry);
        vm.expectRevert(ConveyRecurringGiftHook.InvalidGiftExpiry.selector);
        wallet.execute(hook, calls, false);

        calls[0] = _giftCall(100 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        wallet.execute(hook, calls, false);
        calls[0] = _giftCall(100 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        wallet.execute(hook, calls, false);
        calls[0] = _giftCall(51 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        vm.expectRevert(ConveyRecurringGiftHook.BudgetExceeded.selector);
        wallet.execute(hook, calls, false);

        vm.warp(expiry);
        calls[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));
        vm.expectRevert(ConveyRecurringGiftHook.AuthorizationExpired.selector);
        wallet.execute(hook, calls, false);
    }

    function testBudgetReservationRollsBackWhenWalletExecutionReverts() public {
        IOkxRecurringHook.Call[] memory calls = new IOkxRecurringHook.Call[](1);
        calls[0] = _giftCall(75 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));

        vm.expectRevert(MockRecurringWallet.TargetFailed.selector);
        wallet.execute(hook, calls, true);

        require(hook.spent() == 0, "failed execution consumed budget");
    }

    function testOnlyConfiguredWalletCanCallCallbacks() public {
        IOkxRecurringHook.Call[] memory calls = new IOkxRecurringHook.Call[](1);
        calls[0] = _giftCall(1 ether, MAX_RESERVE, uint64(block.timestamp + 1 days));

        vm.expectRevert(ConveyRecurringGiftHook.OnlyWallet.selector);
        vm.prank(OUTSIDER);
        hook.preCheck(calls, OUTSIDER);

        vm.expectRevert(ConveyRecurringGiftHook.OnlyWallet.selector);
        vm.prank(OUTSIDER);
        hook.postCheck(new bytes(96), OUTSIDER);
    }

    function _giftCall(uint256 amount, uint256 nativeReserve, uint64 giftExpiry)
        private
        pure
        returns (IOkxRecurringHook.Call memory)
    {
        return IOkxRecurringHook.Call({
            target: ESCROW,
            value: nativeReserve,
            data: abi.encodeWithSignature(
                "createGift(address,uint256,bytes32,bytes32,uint64,bytes32)",
                ASSET,
                amount,
                keccak256(bytes("secret")),
                bytes32(0),
                giftExpiry,
                bytes32(0)
            )
        });
    }
}
