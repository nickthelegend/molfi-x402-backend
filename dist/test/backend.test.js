"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
const app_js_1 = require("../app.js");
(0, vitest_1.describe)('Backend Bootstrap Tests', () => {
    let server;
    let port;
    (0, vitest_1.beforeAll)(() => {
        return new Promise((resolve) => {
            server = app_js_1.app.listen(0, () => {
                const address = server.address();
                port = typeof address === 'string' ? 8787 : address?.port || 8787;
                resolve();
            });
        });
    });
    (0, vitest_1.afterAll)(() => {
        return new Promise((resolve) => {
            server.close(() => resolve());
        });
    });
    (0, vitest_1.it)('env validation fails on missing or invalid keys', () => {
        (0, vitest_1.expect)(() => {
            (0, child_process_1.execSync)('npx tsx src/env.ts', {
                env: {
                    BACKEND_OPERATOR_PRIVATE_KEY: 'invalid_key',
                    PATH: process.env.PATH,
                },
                stdio: 'ignore',
            });
        }).toThrow();
    });
    (0, vitest_1.it)('GET /health returns JSON with chain status', async () => {
        const res = await fetch(`http://localhost:${port}/health`);
        (0, vitest_1.expect)(res.status).toBe(200);
        const json = (await res.json());
        (0, vitest_1.expect)(json).toHaveProperty('ok');
        (0, vitest_1.expect)(json.ok).toBe(true);
        (0, vitest_1.expect)(json.chain).toBe(43113);
        (0, vitest_1.expect)(json.operator).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
});
