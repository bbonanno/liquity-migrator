// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;
pragma abicoder v2;

import "hardhat/console.sol";
import "./dependencies/DSProxy.sol";
import "./dependencies/Uniswap.sol";
import "./MakerETHMigrator.sol";

contract FlashSwapManager is IUniswapV3SwapCallback {

    address immutable factory;
    address immutable dai;
    address immutable lusd;
    address migrator;

    constructor(address _factory, address _weth, address _dai, address _lusd) {
        dai = _dai;
        lusd = _lusd;
        factory = _factory;
    }

    function setMigrator(address _migrator) external {
        require(migrator == address(0));
        migrator = _migrator;
    }

    function uniswapV3SwapCallback(int256 borrowedLusd, int256, bytes calldata data) external override {
        FlashCallbackData memory decoded = abi.decode(data, (FlashCallbackData));
        CallbackValidation.verifyCallback(factory, decoded.poolKey);

        DSProxy(decoded.proxy).execute(
            migrator,
            abi.encodeWithSelector(MakerETHMigrator.continueMigration.selector, decoded, uint(borrowedLusd))
        );
    }

    function startFlashSwap(FlashParams memory params) external {
        PoolAddress.PoolKey memory poolKey = PoolAddress.PoolKey({token0 : lusd, token1 : dai, fee : params.uniswapFee});

        IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey)).swap(
            params.proxy,
            true,
            - int(params.daiAmount),
            TickMath.MIN_SQRT_RATIO + 1,
            abi.encode(
                FlashCallbackData({
                    poolKey: poolKey,
                    cdp: params.cdp,
                    ethToMove: params.ethToMove,
                    proxy: params.proxy,
                    daiAmount: params.daiAmount,
                    liquityMaxFee: params.liquityMaxFee,
                    liquityUpperHint: params.liquityUpperHint,
                    liquityLowerHint: params.liquityLowerHint
                })
            )
        );
    }

    struct FlashCallbackData {
        PoolAddress.PoolKey poolKey;
        uint cdp;
        uint ethToMove;
        address proxy;
        uint256 daiAmount;
        uint liquityMaxFee; 
        address liquityUpperHint; 
        address liquityLowerHint;
    }

    struct FlashParams {
        uint cdp;
        uint ethToMove;
        address proxy;
        uint256 daiAmount;
        uint24 uniswapFee;
        uint liquityMaxFee; 
        address liquityUpperHint; 
        address liquityLowerHint;
    }
}