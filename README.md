# Molfi Backend API

Express-based API server implementing the Coinbase x402 protocol and human attention credit loops on Avalanche Fuji.

## Quickstart

1. **Install dependencies**:
   ```bash
   pnpm install
   ```
2. **Setup environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env and supply keys/addresses
   ```
3. **Run standalone verify script**:
   ```bash
   pnpm run verify-fuji
   ```
4. **Run development server**:
   ```bash
   pnpm run dev
   ```

## Acceptance Checklist

- [ ] `/health` returns status `200` with operator address, USDC balance, and chain status.
- [ ] `/v1/status` returns supported models, current prices, and wallet addresses.
- [ ] `/v1/chat/completions` returns `HTTP 402` when called without a valid `X-PAYMENT` or `Authorization` header.
- [ ] Decodes EIP-3009 signatures sent via `X-PAYMENT` and successfully settles through the facilitator.
- [ ] Logs on-chain transactions and appends explorer URLs in response headers.
- [ ] `/v1/ads/claim` validates ad watch completion and issues HS256-signed JWTs.
