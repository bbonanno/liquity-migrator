import {config as dotEnvConfig} from "dotenv";
import {HardhatUserConfig} from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-etherscan";
import 'hardhat-watcher'

dotEnvConfig();

// TODO: reenable solidity-coverage when it works
// import "solidity-coverage";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    solidity: {
        compilers: [{version: "0.8.4", settings: {}}],
    },
    networks: {
        hardhat: {
            forking: {
                url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
                blockNumber: 12628614
            }
        },
        localhost: {},
        coverage: {
            url: "http://127.0.0.1:8555", // Coverage launches its own ganache-cli client
        },
    },
    etherscan: {
        // Your API key for Etherscan
        // Obtain one at https://etherscan.io/
        apiKey: ETHERSCAN_API_KEY,
    },
    mocha: {
        timeout: 120000
    },
    watcher: {
        test: {
            tasks: [{command: 'test'}],
            files: ['./test/**/*', './contracts'],
            verbose: true,
        },
        compilation: {
            tasks: ["compile"],
            files: ['./contracts'],
            verbose: true
        }
    }
};

export default config;
