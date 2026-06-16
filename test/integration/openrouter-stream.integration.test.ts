import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';
import { addUserCredits, User } from '../../src/credits/store.js';
import { signCreditToken } from '../../src/credits/jwt.js';

describe('openrouter-stream.integration.test.ts - [live-openrouter] OpenRouter completions streaming integration', () => {
  let server: Server;
  let port: number;
  const userId = 'test-openrouter-user';

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    // Clean up test user
    await User.deleteOne({ _id: userId });

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await User.deleteOne({ _id: userId });
    await mongoose.disconnect();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should stream completions from OpenRouter model using credit tokens', async () => {
    // Check if OpenRouter key is set and not default placeholder
    const isMockKey = env.OPENROUTER_API_KEY.includes('f9fb325b5b24fa4054ca1f44b1487e1a69721568d524b0f13c050b0a1efcd0c6');
    if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === '' || (isMockKey && env.NODE_ENV === 'test')) {
      console.warn('⚠️  [live-openrouter] OPENROUTER_API_KEY not configured or is default mock. Skipping test.');
      expect(true).toBe(true);
      return;
    }

    // Add credits to test user
    await addUserCredits(userId, 50);

    const token = signCreditToken(userId, 50);

    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    if (!res.body) throw new Error('Response body is empty');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let streamText = '';
    let foundDone = false;
    let foundMetadata = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const raw = trimmed.slice(6);
          if (raw === '[DONE]') {
            foundDone = true;
          } else {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.choices?.[0]?.delta?.content) {
                streamText += parsed.choices[0].delta.content;
              }
              if (parsed.molfiMetadata) {
                foundMetadata = true;
                expect(parsed.molfiMetadata.paidVia).toBe('credits');
                expect(parsed.molfiMetadata.model).toBe('llama-3.3-70b');
              }
            } catch (err) {
              // ignore parse errors
            }
          }
        }
      }
    }

    console.log(`Stream text returned: "${streamText}"`);
    expect(streamText.length).toBeGreaterThan(0);
    expect(foundDone).toBe(true);
    expect(foundMetadata).toBe(true);
  });
});
