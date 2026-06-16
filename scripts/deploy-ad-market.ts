import pkg from "hardhat";
const { viem } = pkg as any;
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const { FUJI_USDC_ADDRESS, SERVER_SIGNER_ADDRESS, TREASURY_ADDRESS } = process.env;
  
  // Use FUJI_USDC_ADDRESS if USDC_FUJI_ADDRESS is not defined (existing backend .env uses FUJI_USDC_ADDRESS)
  const usdcAddr = FUJI_USDC_ADDRESS || process.env.USDC_FUJI_ADDRESS;
  const signerAddr = SERVER_SIGNER_ADDRESS || process.env.SERVER_SIGNER_ADDRESS;
  const treasuryAddr = TREASURY_ADDRESS || process.env.TREASURY_ADDRESS;

  if (!usdcAddr || !signerAddr || !treasuryAddr) {
    throw new Error(`Missing environment variables. usdcAddr: ${usdcAddr}, signerAddr: ${signerAddr}, treasuryAddr: ${treasuryAddr}`);
  }

  console.log(`Deploying MolfiAdMarket with:`);
  console.log(`- USDC Address: ${usdcAddr}`);
  console.log(`- Server Signer Address: ${signerAddr}`);
  console.log(`- Treasury Address: ${treasuryAddr}`);

  const market = await viem.deployContract("MolfiAdMarket", [usdcAddr, signerAddr, treasuryAddr]);
  console.log("MolfiAdMarket deployed to:", market.address);

  const deployedJsonPath = path.resolve(__dirname, "../.deployed.json");
  fs.writeFileSync(deployedJsonPath, JSON.stringify({ adMarket: market.address }, null, 2));
  console.log(`Saved deployment address to ${deployedJsonPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
