// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;
pragma abicoder v2;

import "hardhat/console.sol";
import "./FlashSwapManager.sol";
import "./dependencies/Maker.sol";
import "./dependencies/DSProxy.sol";
import "./dependencies/Liquity.sol";
import "./dependencies/Uniswap.sol";
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

contract MakerETHMigrator {
    using SafeERC20 for IERC20;

    uint256 constant RAY = 10 ** 27;

    address immutable owner;
    FlashSwapManager immutable flashSwapManager;
    IBorrowerOperations immutable borrowerOperations;
    ITroveManager immutable troveManager;
    IERC20 immutable lusd;
    ManagerLike immutable manager;
    GemJoinLike immutable ethJoin;
    DaiJoinLike immutable daiJoin;
    address immutable factory;

    constructor(FlashSwapManager _flashManager,
        IERC20 _lusd,
        IBorrowerOperations _borrowerOperations,
        ITroveManager _troveManager,
        ManagerLike _manager,
        GemJoinLike _ethJoin,
        DaiJoinLike _daiJoin,
        address _factory) {
        flashSwapManager = _flashManager;
        lusd = _lusd;
        borrowerOperations = _borrowerOperations;
        troveManager = _troveManager;
        manager = _manager;
        ethJoin = _ethJoin;
        daiJoin = _daiJoin;
        factory = _factory;
        owner = msg.sender;
    }

    function migrateVaultToTrove(uint cdp, uint24 uniswapFee, uint liquityMaxFee, address liquityUpperHint, address liquityLowerHint) external {
        (uint ethCollateral, uint daiDebt) = vaultContents(cdp);

        // Save current proxy owner
        address proxyOwner = DSProxy(address(this)).owner();
        // Swap proxy owner so the FlashSwapManager can call it (necessary indirection as the callback only gets passed to msg.sender)
        DSProxy(address(this)).setOwner(address(flashSwapManager));

        flashSwapManager.startFlashSwap(FlashSwapManager.FlashParams({
            cdp : cdp,
            ethToMove : ethCollateral,
            proxy : address(this),
            daiAmount : daiDebt,
            uniswapFee: uniswapFee,
            liquityMaxFee: liquityMaxFee,
            liquityUpperHint: liquityUpperHint,
            liquityLowerHint: liquityLowerHint
        }));

        // Restore proxy owner
        DSProxy(address(this)).setOwner(proxyOwner);
    }

    function continueMigration(FlashSwapManager.FlashCallbackData memory data, uint256 lusdToRepay) external {
        // Pays maker debt and withdraw collateral
        wipeAllAndFreeETH(data);

        // Collect fee of 0.3%
        uint fee = data.ethToMove * 3 / 1000;
        TransferHelper.safeTransferETH(owner, fee);

        if(troveManager.getTroveStatus(address(this)) == ITroveManager.Status.active) {
            // Adjust Liquity trove
            borrowerOperations.adjustTrove{value : data.ethToMove - fee}(data.liquityMaxFee, 0, lusdToRepay, true, data.liquityUpperHint, data.liquityLowerHint);
        } else {
            // Open Liquity trove
            borrowerOperations.openTrove{value : data.ethToMove - fee}(data.liquityMaxFee, lusdToRepay, data.liquityUpperHint, data.liquityLowerHint);
        }

        // Complete swap
        lusd.safeTransfer(PoolAddress.computeAddress(factory, data.poolKey), lusdToRepay);
    }

    function wipeAllAndFreeETH(FlashSwapManager.FlashCallbackData memory data) internal {
        address urn = manager.urns(data.cdp);
        bytes32 ilk = manager.ilks(data.cdp);
        (, uint art) = VatLike(manager.vat()).urns(ilk, urn);

        // Approves adapter to take the DAI amount
        daiJoin.dai().approve(address(daiJoin), data.daiAmount);
        // Joins DAI into the vat
        daiJoin.join(urn, data.daiAmount);
        // Paybacks debt to the CDP and unlocks WETH amount from it
        manager.frob(data.cdp, - int(data.ethToMove), - int(art));
        // Moves the amount from the CDP urn to proxy's address
        manager.flux(data.cdp, address(this), data.ethToMove);
        // Exits WETH amount to proxy address as a token
        ethJoin.exit(address(this), data.ethToMove);
        // Converts WETH to ETH
        ethJoin.gem().withdraw(data.ethToMove);
    }

    function vaultContents(uint cdp) internal view returns (uint ethCollateral, uint daiDebt) {
        address vat = manager.vat();
        address urn = manager.urns(cdp);
        bytes32 ilk = manager.ilks(cdp);

        // Gets actual rate from the vat
        (, uint rate,,,) = VatLike(vat).ilks(ilk);
        // Gets actual art value of the urn
        (uint _eth, uint art) = VatLike(vat).urns(ilk, urn);
        ethCollateral = _eth;
        // Gets actual daiDebt amount in the urn
        uint dai = VatLike(vat).dai(urn);

        uint rad = art * rate - dai;
        daiDebt = rad / RAY;

        // If the rad precision has some dust, it will need to request for 1 extra wad wei
        daiDebt = daiDebt * RAY < rad ? daiDebt + 1 : daiDebt;
    }
}