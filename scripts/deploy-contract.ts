import * as fs from 'fs';
import * as path from 'path';
import solc from 'solc';
import { fileURLToPath } from 'url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const operatorKey = process.env.BACKEND_OPERATOR_PRIVATE_KEY;
const rpcUrl = process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';

const avalancheFuji = {
  id: 43113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'SnowTrace', url: 'https://testnet.snowtrace.io' },
  },
  testnet: true,
} as const;

async function main() {
  console.log('🔨 COMPILING & DEPLOYING IMPRESSIONREGISTRY...');
  
  if (!operatorKey) {
    console.error('Error: BACKEND_OPERATOR_PRIVATE_KEY not defined in .env');
    process.exit(1);
  }

  const contractPath = path.resolve(__dirname, '../contracts/ImpressionRegistry.sol');
  if (!fs.existsSync(contractPath)) {
    console.error(`Error: Solidity contract not found at ${contractPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(contractPath, 'utf8');

  const input = {
    language: 'Solidity',
    sources: {
      'ImpressionRegistry.sol': {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
  };

  console.log('Compiling Solidity code...');
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    let hasError = false;
    for (const err of output.errors) {
      console.log(`[${err.severity.toUpperCase()}] ${err.formattedMessage}`);
      if (err.severity === 'error') hasError = true;
    }
    if (hasError) {
      process.exit(1);
    }
  }

  const contractOutput = output.contracts['ImpressionRegistry.sol']['ImpressionRegistry'];
  const abi = contractOutput.abi;
  const bytecode = contractOutput.evm.bytecode.object;

  const artifactDir = path.resolve(__dirname, '../artifacts');
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir);
  }
  fs.writeFileSync(
    path.join(artifactDir, 'ImpressionRegistry.json'),
    JSON.stringify({ abi, bytecode }, null, 2)
  );
  console.log('Saved compiled artifact to artifacts/ImpressionRegistry.json');

  const account = privateKeyToAccount(operatorKey as `0x${string}`);
  
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http(rpcUrl),
  });

  console.log(`Deploying from account: ${account.address}`);

  try {
    const hash = await walletClient.deployContract({
      abi,
      bytecode: `0x${bytecode}`,
      args: [account.address],
    });

    console.log(`Deployment transaction hash: ${hash}`);
    console.log(`Open in Snowtrace: https://testnet.snowtrace.io/tx/${hash}`);

    console.log('Waiting for transaction block receipt...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Contract successfully deployed!`);
    console.log(`Address: ${receipt.contractAddress}`);
    console.log(`========================================\n`);
    
    updateEnv(receipt.contractAddress as string);
  } catch (error) {
    console.log('\n\x1b[31m============================================================');
    console.log('❌ CONTRACT DEPLOYMENT FAILED (INSUFFICIENT FUNDS / RPC ERROR)');
    console.log('============================================================');
    console.log(`Error details: ${(error as Error).message}`);
    console.log('\nPlease fund the operator address:');
    console.log(`Address: ${account.address}`);
    console.log('- AVAX Faucet: https://faucet.avax.network/');
    console.log('- USDC Faucet: https://faucet.circle.com/');
    console.log('============================================================\n\x1b[0m');

    // Write placeholder to continue pipeline
    const fallbackAddress = '0x0000000000000000000000000000000000000000';
    updateEnv(fallbackAddress);
    console.log(`Set IMPRESSION_REGISTRY_ADDRESS fallback to ${fallbackAddress} to allow compilation to proceed.`);
  }
}

function updateEnv(contractAddress: string) {
  const envPath = path.resolve(__dirname, '../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('IMPRESSION_REGISTRY_ADDRESS=')) {
    envContent = envContent.replace(
      /IMPRESSION_REGISTRY_ADDRESS=.*/,
      `IMPRESSION_REGISTRY_ADDRESS=${contractAddress}`
    );
  } else {
    envContent += `\nIMPRESSION_REGISTRY_ADDRESS=${contractAddress}`;
  }
  fs.writeFileSync(envPath, envContent);
  console.log(`Updated IMPRESSION_REGISTRY_ADDRESS inside molfi-backend/.env`);
}

main().catch((err) => {
  console.error('Fatal deployment script error:', err);
});
