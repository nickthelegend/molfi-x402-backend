import { recoverMessageAddress } from 'viem';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export interface MarketerSessionPayload {
  sub: string; // Lowercase Wallet Address
}

export function generateSessionToken(walletAddress: string): string {
  const payload: MarketerSessionPayload = {
    sub: walletAddress.toLowerCase(),
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' });
}

export function verifySessionToken(token: string): MarketerSessionPayload {
  return jwt.verify(token, env.JWT_SECRET) as MarketerSessionPayload;
}

export async function verifySiweSignature(message: string, signature: string): Promise<string> {
  // Parse wallet address from SIWE message
  // SIWE message format example:
  // domain wants you to sign in with your Ethereum account:
  // 0xAddress
  // ...
  const lines = message.split('\n');
  const index = lines.findIndex(l => l.includes('sign in with your Ethereum account:'));
  if (index === -1 || !lines[index + 1]) {
    throw new Error('Malformed SIWE message: account address line not found.');
  }

  const walletAddress = lines[index + 1].trim().toLowerCase();
  
  // Verify Chain ID matches Fuji (43113)
  const chainIdLine = lines.find(l => l.startsWith('Chain ID:'));
  if (chainIdLine) {
    const chainId = chainIdLine.split(':')[1].trim();
    if (chainId !== '43113') {
      throw new Error('SIWE validation failed: Chain ID must be 43113 (Avalanche Fuji)');
    }
  }

  // Recover signing address from signature
  const recoveredAddress = await recoverMessageAddress({
    message,
    signature: signature as `0x${string}`,
  });

  if (recoveredAddress.toLowerCase() !== walletAddress) {
    throw new Error('SIWE validation failed: Signature recovery address mismatch');
  }

  return recoveredAddress.toLowerCase();
}
