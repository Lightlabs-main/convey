// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    ClaimCallV07,
    ConveyClaimPaymasterV07,
    IEntryPointClaimV07
} from "../contracts/paymaster/ConveyClaimPaymasterV07.sol";
import {PackedUserOperationV07} from "../contracts/bootstrap/ConveyBootstrapPaymasterV07.sol";

interface VmClaimPaymaster {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 newBalance) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 revertData) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockEntryPointClaimV07 is IEntryPointClaimV07 {
    mapping(address account => uint256 amount) private deposits;

    function depositTo(address account) external payable override {
        deposits[account] += msg.value;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return deposits[account];
    }

    function addStake(uint32) external payable override { }
    function unlockStake() external override { }

    function withdrawTo(address payable recipient, uint256 amount) external override {
        require(deposits[msg.sender] >= amount, "deposit");
        deposits[msg.sender] -= amount;
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "send");
    }

    function withdrawStake(address payable) external override { }
}

contract MockClaimEscrow {
    uint8 public state;

    function setState(uint8 state_) external {
        state = state_;
    }

    function giftState(uint256) external view returns (uint8) {
        return state;
    }

    function getGift(uint256)
        external
        view
        returns (
            address sender,
            address asset,
            uint256 amount,
            address claimKey,
            bytes32 codeHash,
            uint64 expiry,
            bytes32 noteHash,
            uint8 stateOut
        )
    {
        return (address(0xA11CE), address(0xB0B), 1, address(0), bytes32(0), 0, bytes32(0), state);
    }
}

contract ConveyClaimPaymasterV07Test {
    VmClaimPaymaster private constant vm =
        VmClaimPaymaster(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address private constant ACCOUNT = address(0xCAFE);
    address private constant REFUND_RECIPIENT = address(0xB0B);
    uint256 private constant SIGNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant OWNER_PRIVATE_KEY = 0xB0B;
    uint256 private constant RESERVE = 1 ether;
    uint256 private constant MAX_COST = 0.2 ether;
    uint48 private constant VALID_AFTER = 100;
    uint48 private constant VALID_UNTIL = 350;

    MockClaimEscrow private escrow;
    ConveyClaimPaymasterV07 private paymaster;
    address private signer;

    function setUp() public {
        vm.chainId(196);
        MockEntryPointClaimV07 mockEntryPoint = new MockEntryPointClaimV07();
        vm.etch(ENTRY_POINT, address(mockEntryPoint).code);

        signer = vm.addr(SIGNER_PRIVATE_KEY);
        escrow = new MockClaimEscrow();
        paymaster = new ConveyClaimPaymasterV07(
            vm.addr(OWNER_PRIVATE_KEY), signer, address(escrow), RESERVE, MAX_COST
        );

        vm.deal(address(this), 5 ether);
        vm.deal(address(escrow), 5 ether);
        vm.deal(vm.addr(OWNER_PRIVATE_KEY), 5 ether);
        vm.deal(REFUND_RECIPIENT, 0);
        vm.prank(address(escrow));
        paymaster.reserveGift{value: RESERVE}(1, REFUND_RECIPIENT);
    }

    function testReserveIsEscrowOnlyAndOwnerCannotWithdrawLockedFunds() public {
        vm.expectRevert(ConveyClaimPaymasterV07.OnlyEscrow.selector);
        paymaster.reserveGift{value: RESERVE}(2, REFUND_RECIPIENT);

        vm.expectRevert(ConveyClaimPaymasterV07.InsufficientSurplus.selector);
        vm.prank(vm.addr(OWNER_PRIVATE_KEY));
        paymaster.withdrawSurplus(payable(vm.addr(OWNER_PRIVATE_KEY)), 1);

        require(paymaster.openReserveTotal() == RESERVE, "reserve total changed");
    }

    function testEscrowBindingIsOneTimeAndOwnerOnly() public {
        ConveyClaimPaymasterV07 unbound = new ConveyClaimPaymasterV07(
            vm.addr(OWNER_PRIVATE_KEY), signer, address(0), RESERVE, MAX_COST
        );

        vm.expectRevert(ConveyClaimPaymasterV07.OnlyOwner.selector);
        vm.prank(REFUND_RECIPIENT);
        unbound.setEscrow(address(escrow));

        vm.prank(vm.addr(OWNER_PRIVATE_KEY));
        unbound.setEscrow(address(escrow));
        require(unbound.escrow() == address(escrow), "escrow was not bound");

        vm.expectRevert(ConveyClaimPaymasterV07.EscrowAlreadySet.selector);
        vm.prank(vm.addr(OWNER_PRIVATE_KEY));
        unbound.setEscrow(address(0xDEAD));
    }

    function testValidationPrechargesMaxCostAndBlocksDuplicateGiftAuthorization() public {
        uint256 sponsorNonce = 7;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);

        vm.prank(ENTRY_POINT);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
        require(context.length != 0, "validation context missing");
        require(paymaster.openReserveTotal() == RESERVE - MAX_COST, "max cost not reserved");
        require(paymaster.inFlightTotal() == MAX_COST, "in-flight cost missing");

        vm.expectRevert(ConveyClaimPaymasterV07.SponsorAuthorizationAlreadyUsed.selector);
        vm.prank(ENTRY_POINT);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
    }

    function testValidationRejectsWrongClaimTarget() public {
        uint256 sponsorNonce = 8;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        ClaimCallV07[] memory calls = new ClaimCallV07[](1);
        calls[0] = ClaimCallV07({target: address(0xDEAD), value: 0, data: bytes("")});
        userOp.callData = abi.encodeWithSelector(
            paymaster.OKX_EXECUTE_USER_OP_SELECTOR(), calls
        );
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);

        vm.expectRevert(ConveyClaimPaymasterV07.InvalidClaimOperation.selector);
        vm.prank(ENTRY_POINT);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
    }

    function testInvalidSignatureReturnsEntryPointValidationFailure() public {
        uint256 sponsorNonce = 9;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);
        bytes memory data = userOp.paymasterAndData;
        data[data.length - 1] = bytes1(uint8(data[data.length - 1]) ^ 1);
        userOp.paymasterAndData = data;

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
        require(validationData == 1, "invalid signature was accepted");
        require(paymaster.inFlightTotal() == 0, "invalid signature changed reserve");
    }

    function testSponsorDigestBindsOperationFieldsWithoutCircularSignatureHash() public {
        uint256 sponsorNonce = 13;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);
        userOp.accountGasLimits = bytes32(uint256(2));

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
        require(validationData == 1, "changed operation field remained authorized");
        require(paymaster.inFlightTotal() == 0, "changed operation field reserved funds");
    }

    function testSuccessfulClaimSettlesReserveAndRefundsUnusedAllowance() public {
        uint256 sponsorNonce = 10;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);

        vm.prank(ENTRY_POINT);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);

        vm.prank(address(escrow));
        paymaster.consumeClaimAuthorization(1, ACCOUNT);
        escrow.setState(1);

        vm.prank(ENTRY_POINT);
        paymaster.postOp(0, context, 0.1 ether, 0);

        require(paymaster.openReserveTotal() == 0, "closed reserve remains locked");
        require(paymaster.inFlightTotal() == 0, "in-flight amount remains");
        require(paymaster.pendingRefundTotal() == 0, "refund was unexpectedly deferred");
        require(REFUND_RECIPIENT.balance == 0.9 ether, "unused allowance was not refunded");
    }

    function testRevertedClaimChargesActualCostAndLeavesGiftReclaimable() public {
        uint256 sponsorNonce = 11;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);

        vm.prank(ENTRY_POINT);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);

        vm.prank(ENTRY_POINT);
        paymaster.postOp(1, context, 0.1 ether, 0);

        require(paymaster.openReserveTotal() == RESERVE - MAX_COST, "failed claim reserve changed");
        require(REFUND_RECIPIENT.balance == 0.1 ether, "unused precharge was not refunded");

        vm.prank(address(escrow));
        paymaster.releaseForReclaim(1, REFUND_RECIPIENT);
        require(paymaster.openReserveTotal() == 0, "reclaimed reserve remains locked");
        require(REFUND_RECIPIENT.balance == 0.9 ether, "reclaim refund was incomplete");
    }

    function testOwnerCannotWithdrawTheOverrunBufferFromAnOpenReserve() public {
        vm.prank(vm.addr(OWNER_PRIVATE_KEY));
        paymaster.deposit{value: RESERVE}();

        uint256 sponsorNonce = 12;
        PackedUserOperationV07 memory userOp = _operation(1, sponsorNonce);
        userOp.paymasterAndData = _paymasterAndData(userOp, 1, sponsorNonce);

        vm.prank(ENTRY_POINT);
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), MAX_COST);
        vm.prank(ENTRY_POINT);
        paymaster.postOp(1, context, 0.3 ether, 0);

        vm.expectRevert(ConveyClaimPaymasterV07.InsufficientSurplus.selector);
        vm.prank(vm.addr(OWNER_PRIVATE_KEY));
        paymaster.withdrawSurplus(payable(vm.addr(OWNER_PRIVATE_KEY)), 1.3 ether);
    }

    function _operation(uint256 giftId, uint256 sponsorNonce)
        private
        view
        returns (PackedUserOperationV07 memory userOp)
    {
        ClaimCallV07[] memory calls = new ClaimCallV07[](1);
        bytes memory claimData = abi.encodeWithSelector(
            paymaster.CLAIM_SELECTOR(), giftId, bytes("secret"), bytes("")
        );
        calls[0] = ClaimCallV07({target: address(escrow), value: 0, data: claimData});
        userOp = PackedUserOperationV07({
            sender: ACCOUNT,
            nonce: sponsorNonce,
            initCode: bytes(""),
            callData: abi.encodeWithSelector(paymaster.OKX_EXECUTE_USER_OP_SELECTOR(), calls),
            accountGasLimits: bytes32(uint256(1)),
            preVerificationGas: 1,
            gasFees: bytes32(uint256(1)),
            paymasterAndData: bytes(""),
            signature: bytes("")
        });
    }

    function _paymasterAndData(
        PackedUserOperationV07 memory userOp,
        uint256 giftId,
        uint256 sponsorNonce
    )
        private
        returns (bytes memory data)
    {
        uint48 validAfter = VALID_AFTER;
        uint48 validUntil = VALID_UNTIL;
        bytes32 digest = paymaster.authorizationDigest(
            paymaster.accountOperationHash(userOp),
            giftId,
            MAX_COST,
            100_000,
            100_000,
            validAfter,
            validUntil,
            sponsorNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        return abi.encodePacked(
            address(paymaster),
            bytes16(uint128(100_000)),
            bytes16(uint128(100_000)),
            bytes32(giftId),
            bytes6(validAfter),
            bytes6(validUntil),
            bytes32(sponsorNonce),
            signature
        );
    }
}
