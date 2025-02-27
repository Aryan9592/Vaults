const hre = require("hardhat");

const { getEnv } = require("../../utils");

const TARGET_STRATEGY = getEnv("TARGET_STRATEGY");

const DEPLOY_SETTINGS = {
    vaultAddress: getEnv("lvDCI_ADDRESS"),
    YCRVStrategy: {
        ratio: "2145",
        minDebtHarvestUsdc: "0",
        maxDebtHarvestUsdc: "1000000000000",
    },
    CVXStrategy: {
        ratio: "2402",
        minDebtHarvestUsdc: "0",
        maxDebtHarvestUsdc: "1000000000000",
    },
    FXSStrategy: {
        ratio: "2914",
        minDebtHarvestUsdc: "0",
        maxDebtHarvestUsdc: "1000000000000",
    },
    AuraBALStrategy: {
        ratio: "1292",
        minDebtHarvestUsdc: "0",
        maxDebtHarvestUsdc: "1000000000000",
    },
    AuraWETHStrategy: {
        ratio: "748",
        minDebtHarvestUsdc: "0",
        maxDebtHarvestUsdc: "1000000000000",
    },
};

async function main() {
    if (!DEPLOY_SETTINGS[TARGET_STRATEGY]) {
        throw new Error(`Invalid target strategy: ${TARGET_STRATEGY}`);
    }

    const [deployer] = await ethers.getSigners();

    const { vaultAddress } = DEPLOY_SETTINGS;
    const { ratio, minDebtHarvestUsdc, maxDebtHarvestUsdc } =
        DEPLOY_SETTINGS[TARGET_STRATEGY];

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = Vault.attach(vaultAddress);

    const Strategy = await hre.ethers.getContractFactory(TARGET_STRATEGY);
    const strategy = await hre.upgrades.deployProxy(
        Strategy,
        [vault.address, deployer.address],
        {
            initializer: "initialize",
            kind: "transparent",
            constructorArgs: [vault.address],
            unsafeAllow: ["constructor"],
        }
    );
    await strategy.deployed();

    console.log(
        `${await strategy.name()} strategy deployed to ${strategy.address} by ${
            deployer.address
        }\n`
    );

    console.log(
        "Vault strategy indicators:",
        await vault.strategies(strategy.address)
    );

    await hre.run("verify:verify", {
        address: strategy.address,
        constructorArguments: [vault.address],
    });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
