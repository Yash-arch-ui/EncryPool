// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

/// @dev Test-only HCULimit implementation that removes BOTH the sequential depth cap
/// AND the per-transaction total HCU budget. Needed because Foundry tests execute
/// the entire test function inside a single EVM transaction, so multiple deposits/draws
/// share one HCU budget and easily exceed the 20M cap.

import {HCULimit} from "@fhevm/host-contracts/contracts/HCULimit.sol";

contract HCULimitNoCap is HCULimit {
    function _adjustAndCheckFheTransactionLimitOneOp(uint256 opHCU, bytes32 op1, bytes32 result)
        internal
        virtual
        override
    {
        _setHCUForHandle(result, opHCU + _getHCUForHandle(op1));
    }

    function _adjustAndCheckFheTransactionLimitTwoOps(uint256 opHCU, bytes32 op1, bytes32 op2, bytes32 result)
        internal
        virtual
        override
    {
        _setHCUForHandle(result, opHCU + _maxHandleHcu(op1, op2));
    }

    function _adjustAndCheckFheTransactionLimitThreeOps(
        uint256 opHCU,
        bytes32 op1,
        bytes32 op2,
        bytes32 op3,
        bytes32 result
    ) internal virtual override {
        uint256 maxInputHcu = _maxHcu(_getHCUForHandle(op1), _maxHcu(_getHCUForHandle(op2), _getHCUForHandle(op3)));
        _setHCUForHandle(result, opHCU + maxInputHcu);
    }

    function _updateAndVerifyHCUTransactionLimit(uint256) internal pure override {}

    function _maxHandleHcu(bytes32 op1, bytes32 op2) private view returns (uint256) {
        uint256 hcu1 = _getHCUForHandle(op1);
        uint256 hcu2 = _getHCUForHandle(op2);
        return hcu1 >= hcu2 ? hcu1 : hcu2;
    }

    function _maxHcu(uint256 hcu1, uint256 hcu2) private pure returns (uint256) {
        return hcu1 >= hcu2 ? hcu1 : hcu2;
    }
}
