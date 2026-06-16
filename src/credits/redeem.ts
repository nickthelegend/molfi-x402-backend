import { verifyCreditToken, CreditClaims } from './jwt.js';
import { SpentCredit } from '../marketers/models.js';

export async function redeem(token: string): Promise<CreditClaims> {
  const claims = verifyCreditToken(token);

  // Atomic insert. Unique index on jti means second redemption throws.
  try {
    await SpentCredit.create({
      jti: claims.jti,
      spentAt: new Date(),
      imp: claims.imp,
    });
  } catch (e: any) {
    if (e?.code === 11000) {
      throw new Error('CREDIT_ALREADY_SPENT');
    }
    throw e;
  }
  return claims;
}
