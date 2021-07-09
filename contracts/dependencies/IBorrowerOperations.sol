// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

interface IBorrowerOperations {

    function openTrove(uint _maxFee, uint _LUSDAmount, address _upperHint, address _lowerHint) external payable;

    function adjustTrove(uint _maxFee, uint _collWithdrawal, uint _debtChange, bool isDebtIncrease, address _upperHint, address _lowerHint) external payable;
}
