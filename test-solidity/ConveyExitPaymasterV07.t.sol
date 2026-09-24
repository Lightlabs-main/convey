// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ConveyExitPaymasterV07, ExitCall, IExitAssetRegistry} from "../contracts/paymaster/ConveyExitPaymasterV07.sol";
import {PackedUserOperationV07} from "../contracts/bootstrap/ConveyBootstrapPaymasterV07.sol";

interface VmExitPaymaster {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 revertData) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract ExitRegistryMock is IExitAssetRegistry {
    mapping(address => bool) internal allowed;

    function setGiftable(address token, bool value) external {
        allowed[token] = value;
    }

    function isGiftable(address token) external view returns (bool) {
        return allowed[token];
    }
}

contract ExitEntryPointMock {
    function callValidate(
        ConveyExitPaymasterV07 paymaster,
        PackedUserOperationV07 calldata userOp,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        return paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);
    }
}

contract ConveyExitPaymasterV07Test {
    VmExitPaymaster private constant vm = VmExitPaymaster(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal owner = address(0xBEEF);
    address internal router = address(0xCAFE);
    address internal usdt0 = address(0xD00D);
    address internal asset = address(0xA551);
    address internal receiver = address(0x1234);
    address internal withdrawalRecipient = address(0x5678);
    ExitRegistryMock internal registry;
    ConveyExitPaymasterV07 internal paymaster;

    function setUp() public {
        vm.chainId(196);
        ExitEntryPointMock mockEntryPoint = new ExitEntryPointMock();
        vm.etch(ENTRY_POINT, address(mockEntryPoint).code);
        registry = new ExitRegistryMock();
        registry.setGiftable(asset, true);
        paymaster = new ConveyExitPaymasterV07(
            owner,
            vm.addr(SIGNER_KEY),
            address(registry),
            router,
            usdt0,
            1 ether
        );
    }

    function testAcceptsLiveWithdrawalPolicy() external {
        ExitCall[] memory calls = new ExitCall[](1);
        calls[0] = ExitCall({target: asset, value: 0, data: abi.encodeWithSelector(0xa9059cbb, withdrawalRecipient, 1 ether)});
        PackedUserOperationV07 memory userOp = _operation(_execute(calls));
        bytes32 actionHash = keccak256(userOp.callData);
        userOp.paymasterAndData = _paymasterData(userOp, actionHash, 0);

        (bytes memory context, uint256 validationData) = ExitEntryPointMock(ENTRY_POINT).callValidate(paymaster, userOp, 1 ether);
        context;
        require(validationData != 1, "signature failed");
    }

    function testRejectsWithdrawalToReceiverItself() external {
        ExitCall[] memory calls = new ExitCall[](1);
        calls[0] = ExitCall({target: asset, value: 0, data: abi.encodeWithSelector(0xa9059cbb, receiver, 1 ether)});
        PackedUserOperationV07 memory userOp = _operation(_execute(calls));
        bytes32 actionHash = keccak256(userOp.callData);
        userOp.paymasterAndData = _paymasterData(userOp, actionHash, 0);
        vm.expectRevert(ConveyExitPaymasterV07.InvalidExitOperation.selector);
        ExitEntryPointMock(ENTRY_POINT).callValidate(paymaster, userOp, 1 ether);
    }

    function testRejectsUnallowlistedWithdrawalToken() external {
        ExitCall[] memory calls = new ExitCall[](1);
        calls[0] = ExitCall({target: address(0x9999), value: 0, data: abi.encodeWithSelector(0xa9059cbb, withdrawalRecipient, 1 ether)});
        PackedUserOperationV07 memory userOp = _operation(_execute(calls));
        bytes32 actionHash = keccak256(userOp.callData);
        userOp.paymasterAndData = _paymasterData(userOp, actionHash, 0);
        vm.expectRevert(ConveyExitPaymasterV07.InvalidExitOperation.selector);
        ExitEntryPointMock(ENTRY_POINT).callValidate(paymaster, userOp, 1 ether);
    }

    function testRejectsCashOutWithoutAllowanceReset() external {
        bytes memory path = abi.encodePacked(asset, uint24(500), usdt0);
        ExitCall[] memory calls = new ExitCall[](3);
        calls[0] = ExitCall({target: asset, value: 0, data: abi.encodeWithSelector(0x095ea7b3, router, 1 ether)});
        calls[1] = ExitCall({target: router, value: 0, data: abi.encodeWithSelector(0xc04b8d59, path, receiver, block.timestamp + 60, 1 ether, 1)});
        calls[2] = ExitCall({target: asset, value: 0, data: abi.encodeWithSelector(0x095ea7b3, router, 1)});
        PackedUserOperationV07 memory userOp = _operation(_execute(calls));
        bytes32 actionHash = keccak256(userOp.callData);
        userOp.paymasterAndData = _paymasterData(userOp, actionHash, 0);
        vm.expectRevert(ConveyExitPaymasterV07.InvalidExitOperation.selector);
        ExitEntryPointMock(ENTRY_POINT).callValidate(paymaster, userOp, 1 ether);
    }

    function _execute(ExitCall[] memory calls) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes4(0x8dd7712f), abi.encode(calls));
    }

    function _operation(bytes memory callData) internal view returns (PackedUserOperationV07 memory) {
        return PackedUserOperationV07({
            sender: receiver,
            nonce: 1,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(uint256(0x1000000000000000000000000000000000000000000000000000000000001000)),
            preVerificationGas: 1000,
            gasFees: bytes32(uint256(0x1000000000000000000000000000000000000000000000000000000000000001)),
            paymasterAndData: "",
            signature: ""
        });
    }

    function _paymasterData(
        PackedUserOperationV07 memory userOp,
        bytes32 actionHash,
        uint256 sponsorNonce
    ) internal returns (bytes memory) {
        bytes32 operationHash = paymaster.accountOperationHash(userOp);
        bytes32 digest = paymaster.authorizationDigest(
            operationHash,
            actionHash,
            1 ether,
            1,
            1,
            uint48(block.timestamp),
            uint48(block.timestamp + 60),
            sponsorNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        require(ecrecover(digest, v, r, s) == vm.addr(SIGNER_KEY), "local signature recovery failed");
        return abi.encodePacked(
            address(paymaster),
            bytes16(uint128(1)),
            bytes16(uint128(1)),
            actionHash,
            uint48(block.timestamp),
            uint48(block.timestamp + 60),
            uint256(sponsorNonce),
            r,
            s,
            v
        );
    }
}
