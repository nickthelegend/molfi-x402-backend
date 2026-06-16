export function buildReceiptHeader(txHash: string, payerAddress: string): string {
  const payload = {
    success: true,
    transaction: txHash,
    network: 'avalanche-fuji',
    payer: payerAddress,
  };
  const jsonStr = JSON.stringify(payload);
  return Buffer.from(jsonStr).toString('base64');
}
