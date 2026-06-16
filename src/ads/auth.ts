import { verifyCreditToken } from "../credits/jwt.js";

export async function requireUserAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token is required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyCreditToken(token);
    req.user = { address: decoded.sub.toLowerCase() };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired credit token' });
  }
}
