const { loadFixture, mine, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");

const IERC20_SOURCE = "@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20";

const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const dai = "0x6b175474e89094c44da98b954eedeac495271d0f";

describe("FraxStrategy", function () {
    const TOKENS = {
        USDT: {
            address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
            whale: "0x461249076b88189f8ac9418de28b365859e46bfd",
            decimals: 6,
        },
        ETH: {
            address: ZERO_ADDRESS,
            whale: "0x00000000219ab540356cbb839cbe05303d7705fa",
            decimals: 18,
        },
        DAI: {
            address: "0x6b175474e89094c44da98b954eedeac495271d0f",
            whale: "0x60faae176336dab62e284fe19b885b095d29fb7f",
            decimals: 18,
        },
        SFRXETH: {
            address: "0xac3E018457B222d93114458476f3E3416Abbe38F",
            whale: "0x857f876490b63bdc7605165e0df568ae54f72d8e",
            decimals: 18,
        },
        FRXETH: {
            address: "0x5E8422345238F34275888049021821E8E08CAa1f",
            whale: "0x79e76c14b3bb6236dfc06d2d7ff219c8b070169c",
            decimals: 18,
        },
    };

    async function deployContractAndSetVariables() {
        const [deployer, governance, treasury, whale] = await ethers.getSigners();
        const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const want = await ethers.getContractAt("IWETH", WETH_ADDRESS);
        await want.connect(whale).deposit({value: ethers.utils.parseEther("10")});

        const name = "ETH Vault";
        const symbol = "vETH";
        const Vault = await ethers.getContractFactory('Vault');
        const vault = await Vault.deploy();
        await vault.deployed();

        await vault['initialize(address,address,address,string,string)'](
            want.address,
            deployer.address,
            treasury.address,
            name,
            symbol
        );
        await vault['setDepositLimit(uint256)'](ethers.utils.parseEther('10000'))

        const FraxStrategy = await ethers.getContractFactory('FraxStrategy');
        const strategy = await FraxStrategy.deploy(vault.address);
        await strategy.deployed();

        await vault['addStrategy(address,uint256,uint256,uint256,uint256)'](
            strategy.address, 
            10000, 
            0, 
            ethers.utils.parseEther('10000'), 
            0
        );

        return { vault, deployer, symbol, name, want, whale, governance, treasury, strategy, want };
    }

    async function dealTokensToAddress(
        address,
        dealToken,
        amountUnscaled = "100"
    ) {
        const token = await ethers.getContractAt(
            IERC20_SOURCE,
            dealToken.address
        );

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [dealToken.whale],
        });
        const tokenWhale = await ethers.getSigner(dealToken.whale);

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [TOKENS.ETH.whale],
        });
        const ethWhale = await ethers.getSigner(TOKENS.ETH.whale);

        await ethWhale.sendTransaction({
            to: tokenWhale.address,
            value: ethers.utils.parseEther("0.5"),
        });

        console.log("whale: ", tokenWhale.address);
        console.log("token: ", token.address);
        console.log("deal whale balance: ", await token.balanceOf(tokenWhale.address));
        await token
            .connect(tokenWhale)
            .transfer(
                address,
                ethers.utils.parseUnits(amountUnscaled, dealToken.decimals)
            );
    }

    it('should deploy strategy', async function () {
        const { vault, strategy } = await loadFixture(deployContractAndSetVariables);
        expect(await strategy.vault()).to.equal(vault.address);
    });

    it('should harvest with a profit', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const SfrxEth = await ethers.getContractAt("ISfrxEth", TOKENS.SFRXETH.address);
        const balanceBefore = await want.balanceOf(whale.address);
        
        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));
        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));

        await strategy.connect(deployer).harvest();
        mine(1);

        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.005'));

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x79e76c14b3bb6236dfc06d2d7ff219c8b070169c"],
        });
        const FrxEth = await ethers.getContractAt(
            IERC20_SOURCE,
            "0x5E8422345238F34275888049021821E8E08CAa1f"
        );
        const frxWhale = await ethers.getSigner("0x79e76c14b3bb6236dfc06d2d7ff219c8b070169c");

        for (let index = 0; index < 1; index++) {
            mine(604800); // get more rewards
            await FrxEth.connect(frxWhale).transfer(SfrxEth.address, ethers.utils.parseEther('10'));
            await SfrxEth.syncRewards();
        }
        await strategy.connect(deployer).harvest();

        expect(Number(await strategy.estimatedTotalAssets()))
        .to.be.greaterThan(Number(ethers.utils.parseEther('10')));
        await vault.connect(whale)['withdraw()']();

        expect(Number(await want.balanceOf(whale.address))).to.be.greaterThan(Number(balanceBefore));
    });

    it('should fail harvest with small bpt slippage', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const balanceBefore = await want.balanceOf(whale.address);
        
        await strategy.connect(deployer)['setBptSlippage(uint256)'](9999);
        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));
        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));
        await expect(strategy.connect(deployer).harvest()).to.be.reverted;

        await strategy.connect(deployer)['setBptSlippage(uint256)'](9900);
        await strategy.connect(deployer).harvest();
        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.0025'));
    });


    it('should fail harvest with small rewards slippage', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const balanceBefore = await want.balanceOf(whale.address);
        
        await strategy.connect(deployer)['setRewardsSlippage(uint256)'](9999);
        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));
        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));

        await strategy.connect(deployer).harvest();
        mine(38000); // get more rewards

        await expect(strategy.connect(deployer).harvest()).to.be.reverted;

        await strategy.connect(deployer)['setRewardsSlippage(uint256)'](9700);
        await strategy.connect(deployer).harvest();
        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.0025'));
    });

    it('should withdraw requested amount', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const balanceBefore = await want.balanceOf(whale.address);
        
        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));
        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));

        await strategy.connect(deployer).harvest();
        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.0025'));

        await strategy.connect(deployer).harvest();
        await vault.connect(whale)['withdraw(uint256,address,uint256)'](
            ethers.utils.parseEther('10'), 
            whale.address, 
            3 // 0.02% acceptable loss
        );

        expect(await want.balanceOf(whale.address))
        .to.be.closeTo(balanceBefore, ethers.utils.parseEther('0.004'));
    });

    it('should withdraw with loss', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const balanceBefore = await want.balanceOf(whale.address);
        
        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));

        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));

        await strategy.connect(deployer).harvest();

        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.0025'));

        await strategy.connect(deployer).tend();

        await vault.connect(whale)['withdraw(uint256,address,uint256)'](
            ethers.utils.parseEther('10'), 
            whale.address, 
            5 // 0.05% acceptable loss
        );

        expect(await want.balanceOf(whale.address))
        .to.be.closeTo(balanceBefore, ethers.utils.parseEther('0.004'));
    });

    it('should not withdraw with loss', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        await want.connect(whale).approve(vault.address, ethers.utils.parseEther('10'));
        await vault.connect(whale)['deposit(uint256)'](ethers.utils.parseEther('10'));

        const balanceBefore = await want.balanceOf(whale.address);

        expect(await want.balanceOf(vault.address)).to.equal(ethers.utils.parseEther('10'));

        await strategy.connect(deployer).harvest();

        expect(await strategy.estimatedTotalAssets())
        .to.be.closeTo(ethers.utils.parseEther('10'), ethers.utils.parseEther('0.0025'));

        await strategy.connect(deployer).tend();

        await expect( 
            vault.connect(whale)['withdraw(uint256,address,uint256)'](
                ethers.utils.parseEther('10'), 
                whale.address, 
                0 // 0% acceptable loss
            )
        ).to.be.reverted;

        expect(await want.balanceOf(whale.address)).to.equal(balanceBefore);
    });

    it('should emergency exit', async function () {
        const { vault, strategy, whale, want } = await loadFixture(deployContractAndSetVariables); 

        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);
        expect(await want.balanceOf(vault.address)).to.equal(oneEther);

        await strategy.harvest();
        mine(100);

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            oneEther, 
            ethers.utils.parseEther('0.0025')
        );

        await strategy.setEmergencyExit();
        await strategy.harvest();

        expect(await strategy.estimatedTotalAssets()).to.equal(0);
        expect(await want.balanceOf(vault.address)).to.be.closeTo(
            oneEther, 
            ethers.utils.parseEther('0.0025')
        );
    });

    it('should sweep', async function () {
        const { vault, deployer, strategy, whale, want } = await loadFixture(deployContractAndSetVariables); 

        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).transfer(strategy.address, oneEther);

        expect(want.address).to.equal(await strategy.want());
        expect(Number(await want.balanceOf(strategy.address))).to.greaterThan(Number(0));

        await expect( 
            strategy.connect(deployer)['sweep(address)'](want.address)
        ).to.be.revertedWith("!want");
        await expect( 
            strategy.connect(deployer)['sweep(address)'](vault.address)
        ).to.be.revertedWith("!shares");
        await expect( 
            strategy.connect(deployer)['sweep(address)'](bRethStable)
        ).to.be.revertedWith("!protected");
        await expect( 
            strategy.connect(deployer)['sweep(address)'](auraBRethStable)
        ).to.be.revertedWith("!protected");
        await expect( 
            strategy.connect(deployer)['sweep(address)'](aura)
        ).to.be.revertedWith("!protected");
        await expect( 
            strategy.connect(deployer)['sweep(address)'](bal)
        ).to.be.revertedWith("!protected");

        const daiToken = await hre.ethers.getContractAt(
            IERC20_SOURCE, 
            dai
        );
        const daiWhaleAddress = "0x60faae176336dab62e284fe19b885b095d29fb7f";
        await network.provider.request({method:"hardhat_impersonateAccount",params:[daiWhaleAddress]});
        const daiWhale = await ethers.getSigner(daiWhaleAddress);

        await daiToken.connect(daiWhale).transfer(
            strategy.address,
            ethers.utils.parseEther("10")
        );
        expect(daiToken.address).not.to.be.equal(await strategy.want());
        await expect( 
            () => strategy.connect(deployer)['sweep(address)'](daiToken.address)
        ).to.changeTokenBalances(
            daiToken,
            [strategy, deployer],
            [ethers.utils.parseEther('-10'), ethers.utils.parseEther('10')]
        );
    });

    it('should change debt', async function () {
        const { vault, strategy, deployer, whale, want } = await loadFixture(deployContractAndSetVariables); 
        
        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);
        await vault.connect(deployer)['updateStrategyDebtRatio(address,uint256)'](strategy.address, 5000);
        mine(100);
        await strategy.harvest();

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('0.5'), 
            ethers.utils.parseEther('0.0025')
        );

        await vault.connect(deployer)['updateStrategyDebtRatio(address,uint256)'](strategy.address, 10000);
        mine(100);
        await strategy.harvest();

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );

        await vault.connect(deployer)['updateStrategyDebtRatio(address,uint256)'](strategy.address, 5000);
        mine(100);
        await strategy.harvest();

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('0.5'), 
            ethers.utils.parseEther('0.0025')
        );
    });

    it('should trigger', async function () {
        const { vault, strategy, deployer, whale, want } = await loadFixture(deployContractAndSetVariables); 
        
        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);
        await vault.connect(deployer)['updateStrategyDebtRatio(address,uint256)'](strategy.address, 5000);
        mine(1);
        await strategy.harvest();

        await strategy.harvestTrigger(0);
        await strategy.tendTrigger(0);
    });

    it('should migrate', async function () {
        const { vault, strategy, deployer, whale, want } = await loadFixture(deployContractAndSetVariables); 
        
        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);

        await strategy.harvest();
        mine(100);

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );

        const RocketAuraStrategy = await ethers.getContractFactory('RocketAuraStrategy');
        const newStrategy = await RocketAuraStrategy.deploy(vault.address);
        await newStrategy.deployed();

        const auraToken = await hre.ethers.getContractAt(IERC20_SOURCE, aura);
        const balToken = await hre.ethers.getContractAt(IERC20_SOURCE, bal);
        const bRethStableToken = await hre.ethers.getContractAt(IERC20_SOURCE, bRethStable);
        const auraBRethStableToken = await hre.ethers.getContractAt(IERC20_SOURCE, auraBRethStable);

        await vault['migrateStrategy(address,address)'](strategy.address, newStrategy.address);

        expect(await strategy.estimatedTotalAssets()).to.be.equal(0);
        expect(await newStrategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );
        expect(Number(await auraToken.balanceOf(newStrategy.address))).to.be.greaterThan(0);
        expect(Number(await balToken.balanceOf(newStrategy.address))).to.be.greaterThan(0);
        expect(Number(await bRethStableToken.balanceOf(newStrategy.address))).to.be.greaterThan(0);
        expect(Number(await auraBRethStableToken.balanceOf(newStrategy.address))).to.be.equal(0);

        mine(100);
        await newStrategy.harvest();

        expect(Number(await auraToken.balanceOf(newStrategy.address))).to.be.equal(0);
        expect(Number(await balToken.balanceOf(newStrategy.address))).to.be.equal(0);
        expect(Number(await bRethStableToken.balanceOf(newStrategy.address))).to.be.equal(0);
        expect(Number(await auraBRethStableToken.balanceOf(newStrategy.address))).to.be.greaterThan(0);

        expect(await newStrategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );
    });

    it('should revoke from vault', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);
        mine(1);
        await strategy.harvest();

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );

        await vault['revokeStrategy(address)'](strategy.address);
        mine(100);
        await strategy.harvest();
        expect(await want.balanceOf(vault.address)).to.be.closeTo(
            oneEther, 
            ethers.utils.parseEther('0.0025')
        );
    });

    it('should withdraw on vault shutdown', async function () {
        const { vault, strategy, whale, deployer, want } = await loadFixture(deployContractAndSetVariables); 

        const oneEther = ethers.utils.parseEther('1');
        await want.connect(whale).approve(vault.address, oneEther);
        await vault.connect(whale)['deposit(uint256)'](oneEther);
        expect(await want.balanceOf(vault.address)).to.equal(oneEther);

        if(await want.balanceOf(whale.address) > 0){
            want.connect(whale).transfer(ZERO_ADDRESS, await want.balanceOf(whale.address));
        }
        await strategy.harvest();
        mine(3600*7);

        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
            ethers.utils.parseEther('1'), 
            ethers.utils.parseEther('0.0025')
        );

        await vault['setEmergencyShutdown(bool)'](true);
        mine(1);
        await vault.connect(whale)['withdraw(uint256,address,uint256)'](
            ethers.utils.parseEther('1'), 
            whale.address, 
            5 // 0.05% acceptable loss
        );
        expect(await want.balanceOf(whale.address)).to.be.closeTo(
            oneEther, 
            ethers.utils.parseEther('0.0025')
        );
    });

    it('should scale decimals', async function () {
        const { vault } = await loadFixture(deployContractAndSetVariables); 

        const TestScaler = await ethers.getContractFactory('TestScaler');
        const testScaler = await TestScaler.deploy(vault.address);
        await testScaler.deployed();

        expect(await testScaler.scaleDecimals(
            ethers.utils.parseEther('1'),
            usdt,
            bal
        )).to.be.equal(BigNumber.from('1000000000000000000000000000000'));

        expect(await testScaler.scaleDecimals(
            ethers.utils.parseEther('1'),
            bal,
            usdt
        )).to.be.equal(BigNumber.from('1000000'));

        expect(await testScaler.scaleDecimals(
            ethers.utils.parseEther('1'),
            bal,
            dai
        )).to.be.equal(BigNumber.from('1000000000000000000'));
    });

    it('should not get aura rewards after inflation protection time', async function () {
        const { strategy } = await loadFixture(deployContractAndSetVariables); 

        expect(
            await strategy.auraRewards(ethers.utils.parseEther('1'))
        ).to.be.equal(ethers.utils.parseEther('3.4'));

        const iAuraToken = await ethers.getContractAt("IAuraToken", aura);
        const minter = await iAuraToken.minter();
        const iAuraMinter = await ethers.getContractAt("IAuraMinter", minter);
        const inflationProtectionTime = await iAuraMinter.inflationProtectionTime();

        await time.setNextBlockTimestamp(inflationProtectionTime);
        mine(2);

        expect(
            await strategy.auraRewards(ethers.utils.parseEther('1'))
        ).to.be.equal(0);
    });
});