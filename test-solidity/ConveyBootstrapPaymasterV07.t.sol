// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    BootstrapCallV07,
    ConveyBootstrapPaymasterV07,
    PackedUserOperationV07
} from "../contracts/bootstrap/ConveyBootstrapPaymasterV07.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external returns (address);
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 newBalance) external;
}

contract MockEntryPointV07 {
    mapping(address => uint256) private deposits;

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function addStake(uint32) external payable { }
    function unlockStake() external { }
    function withdrawTo(address payable recipient, uint256 amount) external {
        require(deposits[msg.sender] >= amount, "insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool sent,) = recipient.call{ value: amount }("");
        require(sent, "withdraw failed");
    }
    function withdrawStake(address payable) external { }

    /// @dev Model EntryPoint's packed validity-window check for the local unit test.
    function checkPaymasterValidity(
        ConveyBootstrapPaymasterV07 targetPaymaster,
        PackedUserOperationV07 calldata userOp,
        uint256 maxCost
    ) external returns (bytes memory context) {
        uint256 validationData;
        (context, validationData) =
            targetPaymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);
        require(address(uint160(validationData)) == address(0), "signature failed");
        uint48 validUntil = uint48(validationData >> 160);
        uint48 validAfter = uint48(validationData >> 208);
        require(validUntil == 0 || block.timestamp <= validUntil, "authorization expired");
        require(block.timestamp >= validAfter, "authorization not active");
    }
}

contract ConveyBootstrapPaymasterV07Test {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 private constant OWNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant SPONSOR_PRIVATE_KEY = 0xB0B;
    uint256 private constant OTHER_PRIVATE_KEY = 0xCAFE;
    uint256 private constant MAX_COST = 123456789;
    uint256 private constant SPONSOR_NONCE = 7;
    uint128 private constant PAYMASTER_VERIFICATION_GAS_LIMIT = 135000;
    uint48 private constant VALID_AFTER = 100;
    uint48 private constant VALID_UNTIL = 350;
    bytes32 private constant EXPECTED_PROBE_CALL_DATA_HASH =
        0x947bcf1a07efe70c78984357f24a7dbd12df502b98c238eecdf1097cf7b5bad2;
    bytes4 private constant OKX_EXECUTE_USER_OP_SELECTOR = bytes4(
        keccak256(
            "executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)"
        )
    );

    ConveyBootstrapPaymasterV07 private paymaster;
    address private owner;
    address private signer;
    address private sender;
    bytes private initCode;
    bytes private callData;

    function setUp() public {
        vm.chainId(196);
        MockEntryPointV07 mock = new MockEntryPointV07();
        vm.etch(ENTRY_POINT, address(mock).code);

        owner = vm.addr(OWNER_PRIVATE_KEY);
        signer = vm.addr(SPONSOR_PRIVATE_KEY);
        sender = address(0x123456);
        initCode = hex"12345678";
        // Fixture hash represents the one zero-value address(0) call envelope.
        callData = _callDataFor(address(0), 0, bytes(""));
        paymaster = _deployPaymaster(signer);
    }

    function testOnlyEntryPointCanValidateOrCallPostOp() public {
        PackedUserOperationV07 memory op = _unsignedOperation();
        op.paymasterAndData = _paymasterAndData(address(paymaster));

        (bool validationOk,) = address(paymaster)
            .call(abi.encodeCall(paymaster.validatePaymasterUserOp, (op, bytes32(0), MAX_COST)));
        require(!validationOk, "non-EntryPoint validation succeeded");

        (bool postOpOk,) = address(paymaster)
            .call(abi.encodeCall(paymaster.postOp, (uint8(0), bytes(""), uint256(0), uint256(0))));
        require(!postOpOk, "non-EntryPoint postOp succeeded");

        vm.prank(address(0xBEEF));
        (bool otherEntryPointOk,) = address(paymaster)
            .call(abi.encodeCall(paymaster.validatePaymasterUserOp, (op, bytes32(0), MAX_COST)));
        require(!otherEntryPointOk, "noncanonical EntryPoint succeeded");
    }

    function testOnlyOwnerControlsDepositAndWithdrawal() public {
        address outsider = address(0xBEEF);
        vm.deal(owner, MAX_COST + 1);
        vm.deal(outsider, MAX_COST);

        vm.prank(outsider);
        (bool outsiderDeposit,) = address(paymaster).call{ value: 1 }(
            abi.encodeCall(paymaster.deposit, ())
        );
        require(!outsiderDeposit, "outsider funded through owner function");

        vm.prank(owner);
        paymaster.deposit{ value: MAX_COST }();
        require(MockEntryPointV07(ENTRY_POINT).balanceOf(address(paymaster)) == MAX_COST, "deposit missing");

        vm.prank(owner);
        (bool overCap,) = address(paymaster).call{ value: 1 }(abi.encodeCall(paymaster.deposit, ()));
        require(!overCap, "owner exceeded deposit guard");

        vm.prank(outsider);
        (bool outsiderWithdraw,) = address(paymaster).call(
            abi.encodeCall(paymaster.withdrawTo, (payable(outsider), MAX_COST))
        );
        require(!outsiderWithdraw, "outsider withdrew deposit");

        vm.prank(owner);
        paymaster.withdrawTo(payable(owner), MAX_COST);
        require(MockEntryPointV07(ENTRY_POINT).balanceOf(address(paymaster)) == 0, "deposit not withdrawn");
    }

    function testDirectEntryPointDepositCanExceedPaymasterDepositGuard() public {
        vm.deal(owner, MAX_COST + 1);
        vm.prank(owner);
        paymaster.deposit{ value: MAX_COST }();
        vm.prank(owner);
        MockEntryPointV07(ENTRY_POINT).depositTo{ value: 1 }(address(paymaster));
        require(MockEntryPointV07(ENTRY_POINT).balanceOf(address(paymaster)) == MAX_COST + 1,
            "direct EntryPoint deposit was incorrectly assumed capped");
    }

    function testConfiguredCallDataIsExactlyOneHarmlessCall() public view {
        require(
            keccak256(callData) == paymaster.expectedCallDataHash(),
            "test operation call data differs from the contract policy"
        );
        require(
            paymaster.expectedCallDataHash() == EXPECTED_PROBE_CALL_DATA_HASH,
            "OKX no-op ABI encoding changed"
        );
        require(
            _selector(callData) == OKX_EXECUTE_USER_OP_SELECTOR, "wrong OKX executeUserOp selector"
        );
        BootstrapCallV07[] memory calls = abi.decode(_tail(callData), (BootstrapCallV07[]));
        require(calls.length == 1, "probe is not a single call");
        require(calls[0].target == address(0), "probe target is not address zero");
        require(calls[0].value == 0, "probe transfers value");
        require(calls[0].data.length == 0, "probe has call data");
    }

    function testValidAuthorizationIsAcceptedOnceAndReturnsItsValidityWindow() public {
        PackedUserOperationV07 memory op =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        vm.prank(ENTRY_POINT);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(op, bytes32(0), MAX_COST);

        require(context.length == 0, "bootstrap should not request postOp context");
        require(
            validationData == (uint256(VALID_AFTER) << 208) | (uint256(VALID_UNTIL) << 160),
            "EntryPoint validity window mismatch"
        );
        require(paymaster.authorizationConsumed(), "authorization was not consumed");

        (bool replayOk,) = _validateFromEntryPoint(op, MAX_COST);
        require(!replayOk, "authorization replay succeeded");
    }

    function testAuthorizationBindsGasFieldsAndMaxCost() public {
        PackedUserOperationV07 memory signedOp =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        PackedUserOperationV07 memory changedGas = signedOp;
        changedGas.gasFees = bytes32(uint256(changedGas.gasFees) ^ 1);
        (bool gasOk, bytes memory gasResult) = _validateFromEntryPoint(changedGas, MAX_COST);
        require(gasOk && abi.decode(gasResult, (uint256)) == 1, "gas field was not signed");

        PackedUserOperationV07 memory changedAccountGas = signedOp;
        changedAccountGas.accountGasLimits =
            bytes32(uint256(changedAccountGas.accountGasLimits) ^ 1);
        (bool accountGasOk, bytes memory accountGasResult) =
            _validateFromEntryPoint(changedAccountGas, MAX_COST);
        require(
            accountGasOk && abi.decode(accountGasResult, (uint256)) == 1,
            "account gas field was not signed"
        );

        PackedUserOperationV07 memory changedPreVerificationGas = signedOp;
        changedPreVerificationGas.preVerificationGas += 1;
        (bool preVerificationOk, bytes memory preVerificationResult) =
            _validateFromEntryPoint(changedPreVerificationGas, MAX_COST);
        require(
            preVerificationOk && abi.decode(preVerificationResult, (uint256)) == 1,
            "pre-verification gas was not signed"
        );

        PackedUserOperationV07 memory changedNonce = signedOp;
        changedNonce.nonce += 1;
        (bool nonceOk, bytes memory nonceResult) = _validateFromEntryPoint(changedNonce, MAX_COST);
        require(nonceOk && abi.decode(nonceResult, (uint256)) == 1, "account nonce was not signed");

        (bool costOk, bytes memory costResult) = _validateFromEntryPoint(signedOp, MAX_COST - 1);
        require(costOk && abi.decode(costResult, (uint256)) == 1, "maxCost was not signed");
    }

    function testAuthorizationIsBoundToChainAndPaymaster() public {
        PackedUserOperationV07 memory op =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        vm.chainId(1);
        (bool wrongChainOk,) = _validateFromEntryPoint(op, MAX_COST);
        require(!wrongChainOk, "other chain accepted authorization");

        vm.chainId(196);
        ConveyBootstrapPaymasterV07 otherPaymaster = _deployPaymaster(signer);
        PackedUserOperationV07 memory replayOnOtherContract =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        replayOnOtherContract.paymasterAndData = _authorizationData(
            address(otherPaymaster),
            SPONSOR_NONCE,
            _signatureFor(paymaster, replayOnOtherContract, MAX_COST, SPONSOR_PRIVATE_KEY)
        );
        (bool otherPaymasterCallOk, bytes memory otherPaymasterResult) =
            _validateOtherFromEntryPoint(otherPaymaster, replayOnOtherContract, MAX_COST);
        require(
            otherPaymasterCallOk && abi.decode(otherPaymasterResult, (uint256)) == 1,
            "other paymaster accepted signature"
        );
    }

    function testWrongSenderFactoryOrCallCannotBeSponsored() public {
        PackedUserOperationV07 memory wrongSender = _unsignedOperation();
        wrongSender.sender = address(0xDEAD);
        wrongSender.paymasterAndData = _paymasterAndData(address(paymaster));
        (bool senderOk,) = _validateFromEntryPoint(wrongSender, MAX_COST);
        require(!senderOk, "wrong sender accepted");

        PackedUserOperationV07 memory wrongFactory = _unsignedOperation();
        wrongFactory.initCode = hex"ffffffff";
        wrongFactory.paymasterAndData = _paymasterAndData(address(paymaster));
        (bool factoryOk,) = _validateFromEntryPoint(wrongFactory, MAX_COST);
        require(!factoryOk, "wrong factory initCode accepted");

        PackedUserOperationV07 memory wrongCall = _unsignedOperation();
        wrongCall.callData = _callDataFor(address(0), 1, bytes(""));
        wrongCall.paymasterAndData = _paymasterAndData(address(paymaster));
        (bool nonzeroValueOk,) = _validateFromEntryPoint(wrongCall, MAX_COST);
        require(!nonzeroValueOk, "nonzero-value call accepted");

        PackedUserOperationV07 memory nonemptyCallData = _unsignedOperation();
        nonemptyCallData.callData = _callDataFor(address(0), 0, hex"1234");
        nonemptyCallData.paymasterAndData = _paymasterAndData(address(paymaster));
        (bool nonemptyCallOk,) = _validateFromEntryPoint(nonemptyCallData, MAX_COST);
        require(!nonemptyCallOk, "call with nonempty target data accepted");

        PackedUserOperationV07 memory wrongTarget = _unsignedOperation();
        wrongTarget.callData = _callDataFor(address(0xBEEF), 0, bytes(""));
        wrongTarget.paymasterAndData = _paymasterAndData(address(paymaster));
        (bool wrongTargetOk,) = _validateFromEntryPoint(wrongTarget, MAX_COST);
        require(!wrongTargetOk, "nonzero target accepted");
    }

    function testCostCapAndPaymasterFieldsAreEnforced() public {
        PackedUserOperationV07 memory op =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        (bool overCapOk,) = _validateFromEntryPoint(op, MAX_COST + 1);
        require(!overCapOk, "operation above maxCost cap accepted");

        PackedUserOperationV07 memory wrongPaymaster =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        wrongPaymaster.paymasterAndData[0] = bytes1(uint8(0xff));
        (bool headerOk,) = _validateFromEntryPoint(wrongPaymaster, MAX_COST);
        require(!headerOk, "wrong paymaster header accepted");

        PackedUserOperationV07 memory wrongVerificationLimit =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        wrongVerificationLimit.paymasterAndData[35] = bytes1(uint8(1));
        (bool verificationLimitOk,) = _validateFromEntryPoint(wrongVerificationLimit, MAX_COST);
        require(!verificationLimitOk, "wrong paymaster verification gas accepted");

        PackedUserOperationV07 memory nonzeroPostOpLimit =
            _signedOperation(paymaster, MAX_COST, SPONSOR_PRIVATE_KEY);
        nonzeroPostOpLimit.paymasterAndData[51] = bytes1(uint8(1));
        (bool postOpLimitOk,) = _validateFromEntryPoint(nonzeroPostOpLimit, MAX_COST);
        require(!postOpLimitOk, "nonzero postOp gas accepted");

        PackedUserOperationV07 memory malformed = _unsignedOperation();
        malformed.paymasterAndData = hex"1234";
        (bool malformedOk,) = _validateFromEntryPoint(malformed, MAX_COST);
        require(!malformedOk, "malformed paymaster data accepted");
    }

    function testWrongSponsorNonceAndInvalidSignatureFailClosed() public {
        PackedUserOperationV07 memory wrongNonce = _unsignedOperation();
        wrongNonce.paymasterAndData = _paymasterAndData(address(paymaster));
        bytes32 digest = paymaster.sponsorDigest(
            wrongNonce, MAX_COST, VALID_AFTER, VALID_UNTIL, SPONSOR_NONCE + 1
        );
        wrongNonce.paymasterAndData = _authorizationData(
            address(paymaster), SPONSOR_NONCE + 1, _sign(SPONSOR_PRIVATE_KEY, digest)
        );
        (bool nonceOk,) = _validateFromEntryPoint(wrongNonce, MAX_COST);
        require(!nonceOk, "wrong sponsor nonce accepted");

        PackedUserOperationV07 memory wrongSigner =
            _signedOperation(paymaster, MAX_COST, OTHER_PRIVATE_KEY);
        (bool signerOk, bytes memory result) = _validateFromEntryPoint(wrongSigner, MAX_COST);
        require(
            signerOk && abi.decode(result, (uint256)) == 1, "invalid signature did not fail closed"
        );
        require(!paymaster.authorizationConsumed(), "invalid signature consumed authorization");
    }

    function testValidityWindowMustBeShortAndFinite() public {
        PackedUserOperationV07 memory op = _unsignedOperation();
        bytes32 digest = paymaster.sponsorDigest(op, MAX_COST, 1, 0, SPONSOR_NONCE);
        op.paymasterAndData = _authorizationData(
            address(paymaster), SPONSOR_NONCE, _sign(SPONSOR_PRIVATE_KEY, digest), 1, 0
        );
        (bool infiniteOk,) = _validateFromEntryPoint(op, MAX_COST);
        require(!infiniteOk, "infinite authorization accepted");

        digest = paymaster.sponsorDigest(op, MAX_COST, 1, 302, SPONSOR_NONCE);
        op.paymasterAndData = _authorizationData(
            address(paymaster), SPONSOR_NONCE, _sign(SPONSOR_PRIVATE_KEY, digest), 1, 302
        );
        (bool longOk,) = _validateFromEntryPoint(op, MAX_COST);
        require(!longOk, "long authorization window accepted");
    }

    function testExpiredAuthorizationIsRejectedByEntryPointValidityCheck() public {
        PackedUserOperationV07 memory op = _unsignedOperation();
        bytes32 digest = paymaster.sponsorDigest(op, MAX_COST, 1, 100, SPONSOR_NONCE);
        op.paymasterAndData = _authorizationData(
            address(paymaster), SPONSOR_NONCE, _sign(SPONSOR_PRIVATE_KEY, digest), 1, 100
        );
        vm.warp(101);
        (bool ok,) = ENTRY_POINT.call(
            abi.encodeCall(MockEntryPointV07.checkPaymasterValidity, (paymaster, op, MAX_COST))
        );
        require(!ok, "expired authorization passed EntryPoint validity check");
    }

    function _deployPaymaster(address signer_) private returns (ConveyBootstrapPaymasterV07) {
        return new ConveyBootstrapPaymasterV07(
            owner,
            signer_,
            sender,
            keccak256(initCode),
            SPONSOR_NONCE,
            PAYMASTER_VERIFICATION_GAS_LIMIT,
            MAX_COST
        );
    }

    function _unsignedOperation() private view returns (PackedUserOperationV07 memory op) {
        op = PackedUserOperationV07({
            sender: sender,
            nonce: 0,
            initCode: initCode,
            callData: callData,
            accountGasLimits: bytes32(uint256(0x1234)),
            preVerificationGas: 456,
            gasFees: bytes32(uint256(0x5678)),
            paymasterAndData: bytes(""),
            signature: hex"1234"
        });
    }

    function _signedOperation(
        ConveyBootstrapPaymasterV07 targetPaymaster,
        uint256 maxCost,
        uint256 signerPrivateKey
    ) private returns (PackedUserOperationV07 memory op) {
        op = _unsignedOperation();
        op.paymasterAndData = _paymasterAndData(address(targetPaymaster));
        bytes32 digest =
            targetPaymaster.sponsorDigest(op, maxCost, VALID_AFTER, VALID_UNTIL, SPONSOR_NONCE);
        op.paymasterAndData = _authorizationData(
            address(targetPaymaster), SPONSOR_NONCE, _sign(signerPrivateKey, digest)
        );
    }

    function _signatureFor(
        ConveyBootstrapPaymasterV07 targetPaymaster,
        PackedUserOperationV07 memory op,
        uint256 maxCost,
        uint256 signerPrivateKey
    ) private returns (bytes memory) {
        bytes32 digest = targetPaymaster.sponsorDigest(
            op, maxCost, VALID_AFTER, VALID_UNTIL, SPONSOR_NONCE
        );
        return _sign(signerPrivateKey, digest);
    }

    function _sign(uint256 signerPrivateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _paymasterAndData(address targetPaymaster) private pure returns (bytes memory) {
        return _authorizationData(targetPaymaster, SPONSOR_NONCE, new bytes(65));
    }

    function _callDataFor(address target, uint256 value, bytes memory data)
        private
        pure
        returns (bytes memory)
    {
        BootstrapCallV07[] memory calls = new BootstrapCallV07[](1);
        calls[0] = BootstrapCallV07({ target: target, value: value, data: data });
        return abi.encodeWithSelector(OKX_EXECUTE_USER_OP_SELECTOR, calls);
    }

    function _tail(bytes memory data) private pure returns (bytes memory payload) {
        require(data.length >= 4, "short execution calldata");
        payload = new bytes(data.length - 4);
        for (uint256 i = 4; i < data.length; i++) {
            payload[i - 4] = data[i];
        }
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        require(data.length >= 4, "short execution calldata");
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
    }

    function _authorizationData(
        address targetPaymaster,
        uint256 sponsorNonce,
        bytes memory signature
    ) private pure returns (bytes memory) {
        return _authorizationData(
            targetPaymaster, sponsorNonce, signature, VALID_AFTER, VALID_UNTIL
        );
    }

    function _authorizationData(
        address targetPaymaster,
        uint256 sponsorNonce,
        bytes memory signature,
        uint48 validAfter,
        uint48 validUntil
    ) private pure returns (bytes memory) {
        return abi.encodePacked(
            targetPaymaster,
            PAYMASTER_VERIFICATION_GAS_LIMIT,
            uint128(0),
            validAfter,
            validUntil,
            sponsorNonce,
            signature
        );
    }

    function _validateFromEntryPoint(PackedUserOperationV07 memory op, uint256 maxCost)
        private
        returns (bool ok, bytes memory result)
    {
        vm.prank(ENTRY_POINT);
        (ok, result) = address(paymaster)
            .call(abi.encodeCall(paymaster.validatePaymasterUserOp, (op, bytes32(0), maxCost)));
        if (ok) {
            (, uint256 validationData) = abi.decode(result, (bytes, uint256));
            result = abi.encode(validationData);
        }
    }

    function _validateOtherFromEntryPoint(
        ConveyBootstrapPaymasterV07 otherPaymaster,
        PackedUserOperationV07 memory op,
        uint256 maxCost
    ) private returns (bool ok, bytes memory result) {
        vm.prank(ENTRY_POINT);
        (ok, result) = address(otherPaymaster)
            .call(abi.encodeCall(otherPaymaster.validatePaymasterUserOp, (op, bytes32(0), maxCost)));
        if (ok) {
            (, uint256 validationData) = abi.decode(result, (bytes, uint256));
            result = abi.encode(validationData);
        }
    }
}
