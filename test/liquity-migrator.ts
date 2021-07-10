import {ethers, network} from 'hardhat'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiBignumber from 'chai-bn'
import {config as dotEnvConfig} from "dotenv";
import {
    DSProxy,
    DSProxy__factory,
    DSProxyFactory__factory,
    DssProxyActions,
    DssProxyActions__factory,
    FlashSwapManager,
    FlashSwapManager__factory,
    IBorrowerOperations__factory,
    IERC20,
    IERC20__factory,
    ITroveManager,
    ITroveManager__factory,
    MakerETHMigrator,
    MakerETHMigrator__factory,
    ManagerLike,
    ManagerLike__factory,
    VatLike,
    VatLike__factory,
} from '../typechain'
import {BigNumber, utils} from 'ethers'
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers'

chai.use(chaiBignumber(BigNumber)).use(chaiAsPromised)
const {expect} = chai
const {parseUnits, parseEther, formatBytes32String} = utils;

dotEnvConfig();
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

describe('LiquityMigrator', () => {
    const ethJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
    const daiJoin = '0x9759A6Ac90977b93B58547b4A71c78317f391A28'
    const uniswapFactory = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    const daiAddress = '0x6b175474e89094c44da98b954eedeac495271d0f'
    const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    const lusdAddress = '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0'
    const borrowerOperationsAddress = '0x24179CD81c9e782A4096035f7eC97fB8B783e007'
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let migrator: MakerETHMigrator
    let proxy: DSProxy
    let vaultManager: ManagerLike
    let troveManager: ITroveManager
    let cdpId: BigNumber
    let dai: IERC20
    let weth: IERC20
    let urn: string
    let vat: VatLike
    let flashManager: FlashSwapManager

    before(async () => {
        // await network.provider.request({
        //     method: "hardhat_reset",
        //     params: [{
        //         forking: {
        //             jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        //             blockNumber: 12628614
        //         }
        //     }]
        // })

        const signers = await ethers.getSigners()
        owner = signers[0]
        user = signers[1]
        vaultManager = ManagerLike__factory.connect('0x5ef30b9986345249bc32d8928B7ee64DE9435E39', owner,)
        troveManager = ITroveManager__factory.connect('0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2', owner,)

        //Deploy proxy
        const factory = DSProxyFactory__factory.connect('0xA26e15C895EFc0616177B7c1e7270A4C7D51C997', user,)
        const tx = await factory.build(user.address)
        const events = await factory.queryFilter(
            factory.filters.Created(),
            tx.blockNumber,
        )
        expect(events[0].args.proxy).to.properAddress
        proxy = DSProxy__factory.connect(events[0].args.proxy, user)

        const FlashSwapManagerFactory = (await ethers.getContractFactory('FlashSwapManager', owner,)) as FlashSwapManager__factory
        flashManager = await FlashSwapManagerFactory.deploy(uniswapFactory, daiAddress, lusdAddress,)
        await flashManager.deployed()
        expect(flashManager.address).to.properAddress

        const migratorFactory = (await ethers.getContractFactory(
            'MakerETHMigrator',
            owner,
        )) as MakerETHMigrator__factory
        migrator = await migratorFactory.deploy(
            flashManager.address,
            lusdAddress,
            borrowerOperationsAddress,
            troveManager.address,
            vaultManager.address,
            ethJoin,
            daiJoin,
            uniswapFactory,
        )
        await migrator.deployed()
        expect(migrator.address).to.properAddress

        await flashManager.setMigrator(migrator.address)
    })

    beforeEach(async () => {
        await openVault()
    })

    async function openVault() {
        const initialBalance = await user.getBalance()
        const actions = DssProxyActions__factory.connect('0x82ecD135Dce65Fbc6DbdD0e4237E0AF93FFD5038', user,)
        const callData = actions.interface.encodeFunctionData(
            'openLockETHAndDraw',
            [
                vaultManager.address,
                '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
                ethJoin,
                daiJoin,
                formatBytes32String('ETH-A'),
                parseUnits('5000'),
            ],
        )

        await proxy.execute(actions.address, callData, {value: parseEther('100'),})

        dai = IERC20__factory.connect(daiAddress, user)
        weth = IERC20__factory.connect(wethAddress, user)
        expect(await dai.balanceOf(user.address)).to.eq(parseUnits('5000'))
        //gas consumption means we can't perform strict equality
        expect(await user.getBalance()).to.be.bignumber.that.is.lessThan(initialBalance.sub(parseEther('100')),)

        cdpId = await vaultManager.last(proxy.address)
        urn = await vaultManager.urns(cdpId)
        const _vat = await vaultManager.vat()
        vat = VatLike__factory.connect(_vat, owner)

        const [collateral, debt] = await currentDebtAndCollateral()

        expect(collateral).to.be.bignumber.that.is.eq(parseEther('100'))
        expect(debt).to.be.bignumber.that.is.eq(parseUnits('5000'))

        await dai.transfer('0x0000000000000000000000000000000000000000', parseUnits('5000'),)
        expect(await dai.balanceOf(user.address)).to.be.eq(0)
    }

    async function currentDebtAndCollateral() {
        const ilks = await vaultManager.ilks(cdpId)
        const [, rate, , ,] = await vat.ilks(ilks)
        const [collateral, debt] = await vat.urns(ilks, urn)
        const vatDai = await vat.dai(urn)
        return [
            collateral,
            debt.mul(rate).sub(vatDai).div(BigNumber.from(10).pow(27)),
        ]
    }

    describe('migrateVaultToTrove', async () => {
        it('can move vault to new trove', async () => {
            const ownerBalance = await owner.getBalance()
            const initialBalance = await user.getBalance()
            const [initialMakerCollateral] = await currentDebtAndCollateral()
            const callData = migrator.interface.encodeFunctionData(
                'migrateVaultToTrove',
                [
                    cdpId,
                    500,
                    parseUnits('0.01'),
                    proxy.address,
                    proxy.address,
                ],
            )

            await proxy.execute(migrator.address, callData)

            expect(await dai.balanceOf(user.address)).to.be.eq(0)
            expect(await dai.balanceOf(proxy.address)).to.be.eq(0)
            expect(await weth.balanceOf(proxy.address)).to.be.eq(0)
            const proxyOwner = await proxy.owner()
            expect(proxyOwner).to.properAddress
            expect(proxyOwner).to.be.eq(user.address)
            expect(await user.getBalance()).to.be.bignumber.that.is.lt(
                initialBalance,
            )
            const [makerCollateral, makerDebt] = await currentDebtAndCollateral()
            expect(makerCollateral).to.be.eq(0)
            expect(makerDebt).to.be.eq(0)
            const [
                liquityDebt,
                liquityCollateral,
            ] = await troveManager.getEntireDebtAndColl(proxy.address)
            const expectedFee = parseUnits("0.3"); // 3% of 100 ETH = 0.3 ETH
            expect(liquityCollateral).to.be.bignumber.eq(initialMakerCollateral.sub(expectedFee))
            expect(liquityDebt).to.be.bignumber.gt(parseUnits('5000'))
            expect(await owner.getBalance()).to.be.bignumber.eq(ownerBalance.add(expectedFee));
        })

        it('can move vault to an existent trove', async () => {
            expect(await troveManager.getTroveStatus(proxy.address)).to.be.eq(1)
            const [initialDebt, initialCollateral,] = await troveManager.getEntireDebtAndColl(proxy.address)
            expect(initialDebt).to.be.gt(0)
            expect(initialCollateral).to.be.gt(0)

            const ownerBalance = await owner.getBalance()
            const initialBalance = await user.getBalance()
            const [initialMakerCollateral] = await currentDebtAndCollateral()
            const callData = migrator.interface.encodeFunctionData(
                'migrateVaultToTrove',
                [cdpId, 500, parseUnits('0.01'), proxy.address, proxy.address,],
            )

            await proxy.execute(migrator.address, callData)

            expect(await dai.balanceOf(user.address)).to.be.eq(0)
            expect(await dai.balanceOf(proxy.address)).to.be.eq(0)
            expect(await weth.balanceOf(proxy.address)).to.be.eq(0)
            const proxyOwner = await proxy.owner()
            expect(proxyOwner).to.properAddress
            expect(proxyOwner).to.be.eq(user.address)
            expect(await user.getBalance()).to.be.bignumber.that.is.lt(
                initialBalance,
            )
            const [makerCollateral, makerDebt] = await currentDebtAndCollateral()
            expect(makerCollateral).to.be.eq(0)
            expect(makerDebt).to.be.eq(0)
            const [liquityDebt, liquityCollateral,] = await troveManager.getEntireDebtAndColl(proxy.address)
            const expectedFee = parseUnits("0.3"); // 3% of 100 ETH = 0.3 ETH
            expect(liquityCollateral).to.be.bignumber.eq(initialMakerCollateral.sub(expectedFee).add(initialCollateral))
            expect(liquityDebt).to.be.bignumber.gt(initialDebt)
            expect(await owner.getBalance()).to.be.bignumber.eq(ownerBalance.add(expectedFee));
        })
    })
})
