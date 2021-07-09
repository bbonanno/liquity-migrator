# Liquity migrator

_Updated to use Hardhat!_

These are a simple set of contracts that use Uniswap V3 flash swaps to migrate an ETH maker vault to a Liquity trove.

## Using this Project

Clone this repository, then install the dependencies with `yarn install`. Build everything with `yarn build`. https://hardhat.org has excellent docs, and can be used as reference for extending this project.

### Deploy to Ethereum

Create/modify network config in `hardhat.config.ts` and add API key and private key, then run:

`npx hardhat run --network rinkeby scripts/deploy.ts`

### Verify on Etherscan

Using the [hardhat-etherscan plugin](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html), add Etherscan API key to `hardhat.config.ts`, then run:

`npx hardhat verify --network rinkeby <DEPLOYED ADDRESS>`

PRs and feedback welcome!
