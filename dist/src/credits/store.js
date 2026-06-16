import mongoose from 'mongoose';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
const mongoUri = env.MONGODB_URI;
export async function connectDb() {
    if (mongoose.connection.readyState === 0) {
        logger.info('Connecting to MongoDB Atlas...');
        await mongoose.connect(mongoUri);
        logger.info('Connected to MongoDB.');
    }
}
if (env.NODE_ENV !== 'test') {
    connectDb().catch((err) => {
        logger.error(err, 'MongoDB connection failed');
    });
}
const userSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    credits: { type: Number, default: 0 },
});
export const User = mongoose.models.User || mongoose.model('User', userSchema);
const adViewSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    ad_id: { type: String, required: true },
    watched_ms: { type: Number, required: true },
    timestamp: { type: Number, required: true },
});
export const AdView = mongoose.models.AdView || mongoose.model('AdView', adViewSchema);
export async function getUserCredits(userId) {
    await connectDb();
    const user = await User.findById(userId.toLowerCase());
    return user ? user.credits : 0;
}
export async function addUserCredits(userId, amount) {
    await connectDb();
    const id = userId.toLowerCase();
    const user = await User.findOneAndUpdate({ _id: id }, { $inc: { credits: amount } }, { new: true, upsert: true });
    return user.credits;
}
export async function decrementUserCredits(userId, amount) {
    await connectDb();
    const id = userId.toLowerCase();
    const result = await User.findOneAndUpdate({ _id: id, credits: { $gte: amount } }, { $inc: { credits: -amount } }, { new: true });
    return result !== null;
}
export async function logAdView(userId, adId, watchedMs) {
    await connectDb();
    const view = new AdView({
        user_id: userId.toLowerCase(),
        ad_id: adId,
        watched_ms: watchedMs,
        timestamp: Math.floor(Date.now() / 1000),
    });
    await view.save();
}
