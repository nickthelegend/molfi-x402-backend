require("@nomicfoundation/hardhat-toolbox-viem");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    fuji: {
      url: process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: process.env.BACKEND_OPERATOR_PRIVATE_KEY ? [process.env.BACKEND_OPERATOR_PRIVATE_KEY] : [],
    }
  },
  gasReporter: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: "dummy-key"
    }
  }
};
