import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { healthRouter } from './routes/health.js';
import { statusRouter } from './routes/status.js';
import { chatRouter } from './chat/routes.js';
import { adsRouter } from './ads/routes.js';
import { marketersRouter } from './marketers/routes.js';

export const app = express();

app.use(cors({
  origin: env.CORS_ORIGINS,
  exposedHeaders: ['X-PAYMENT-RESPONSE'],
}));

app.use(express.json());

// Routes
app.use(healthRouter);
app.use(statusRouter);
app.use(chatRouter);
app.use(adsRouter);
app.use(marketersRouter);
