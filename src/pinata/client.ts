import { PinataSDK } from "pinata-web3";

export const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY!,
});

export function gatewayUrl(cid: string) {
  const gw = (process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud").replace(/\/$/, "");
  return `${gw}/ipfs/${cid}`;
}
