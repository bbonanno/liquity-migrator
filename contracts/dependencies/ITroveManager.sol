// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

interface ITroveManager {

    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    function getEntireDebtAndColl(address _borrower) external view returns (
        uint debt,
        uint coll,
        uint pendingLUSDDebtReward,
        uint pendingETHReward
    );

    function getTroveStatus(address _borrower) external view returns (Status);
}
