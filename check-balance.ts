import mongoose from 'mongoose';
import { env } from './src/env.js';
import { Marketer } from './src/marketers/models.js';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected!');

  try {
    const marketers = await Marketer.find();
    console.log('Registered Marketers in DB:', marketers.map(m => ({ id: m._id, balance: m.balanceUsdc, wallet: m.walletAddress })));

    // Target marketer: 0xcCE40e909E74A25BF66dD495B4ad33Ce2076f906 or similar (lowercased)
    const targetAddress = '0xcce40e909e74a25bf66dd495b4ad33ce2076f906';
    const marketer = await Marketer.findById(targetAddress);
    if (marketer) {
      console.log('Found target marketer:', marketer);
    } else {
      console.log('Target marketer not found!');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(console.error);
