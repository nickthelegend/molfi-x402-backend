import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env
dotenv.config();

import { Campaign, Impression } from '../src/marketers/models.js';
import { pickAd } from '../src/ads/auction.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to DB');

  await Campaign.deleteMany({});
  await Impression.deleteMany({});

  const c1 = new Campaign({
    marketerId: '0xmarketer1',
    title: 'Spent Campaign',
    type: 'video',
    creativeUrl: 'http://test.com/1.mp4',
    durationMs: 15000,
    ctaUrl: 'http://test.com/1',
    bidPerViewUsdc: '0.050000',
    budgetUsdc: '10.000000',
    spentUsdc: '10.000000', // fully spent
    status: 'active',
    targeting: { surfaces: ['frontend'] },
    frequencyCapPerSessionPer4h: 1,
  });
  await c1.save();
  console.log('Campaign c1 saved:', c1._id.toString());

  const c2 = new Campaign({
    marketerId: '0xmarketer2',
    title: 'Active Campaign',
    type: 'video',
    creativeUrl: 'http://test.com/2.mp4',
    durationMs: 15000,
    ctaUrl: 'http://test.com/2',
    bidPerViewUsdc: '0.050000',
    budgetUsdc: '10.000000',
    spentUsdc: '1.000000', // remaining budget
    status: 'active',
    targeting: { surfaces: ['frontend'] },
    frequencyCapPerSessionPer4h: 1,
  });
  await c2.save();
  console.log('Campaign c2 saved:', c2._id.toString());

  const candidates = await Campaign.find({
    status: 'active',
    'targeting.surfaces': 'frontend',
  }).lean();
  console.log('All active candidates:', candidates.map((c: any) => ({ id: c._id.toString(), spent: c.spentUsdc, budget: c.budgetUsdc })));

  const candidatesWithExpr = await Campaign.find({
    status: 'active',
    'targeting.surfaces': 'frontend',
    $expr: { $lt: [{ $toDecimal: '$spentUsdc' }, { $toDecimal: '$budgetUsdc' }] },
  }).lean();
  console.log('Candidates with $expr:', candidatesWithExpr.map((c: any) => c._id.toString()));

  const ad = await pickAd({
    surface: 'frontend',
    viewerSessionHash: 'session-xyz',
  });
  console.log('Picked Ad:', ad);

  await mongoose.disconnect();
}

main().catch(console.error);
