import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { app } from '../app.js';
describe('Backend Bootstrap Tests', () => {
    let server;
    let port;
    beforeAll(() => {
        return new Promise((resolve) => {
            server = app.listen(0, () => {
                const address = server.address();
                port = typeof address === 'string' ? 8787 : address?.port || 8787;
                resolve();
            });
        });
    });
    afterAll(() => {
        return new Promise((resolve) => {
            server.close(() => resolve());
        });
    });
    it('env validation fails on missing or invalid keys', () => {
        expect(() => {
            execSync('npx tsx src/env.ts', {
                env: {
                    BACKEND_OPERATOR_PRIVATE_KEY: 'invalid_key',
                    PATH: process.env.PATH,
                },
                stdio: 'ignore',
            });
        }).toThrow();
    });
    it('GET /health returns JSON with chain status', async () => {
        const res = await fetch(`http://localhost:${port}/health`);
        expect(res.status).toBe(200);
        const json = (await res.json());
        expect(json).toHaveProperty('ok');
        expect(json.ok).toBe(true);
        expect(json.chain).toBe(43113);
        expect(json.operator).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
});
