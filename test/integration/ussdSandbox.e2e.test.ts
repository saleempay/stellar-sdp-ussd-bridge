/**
 * Live Africa's Talking sandbox run of the bridge's USSD service, gated on
 * RUN_AT_SANDBOX_E2E=1. The test starts the service, prints the capture
 * banner (callback path masked), and waits for an operator-driven session
 * set on the simulator with one Deliverable 2 recipient:
 *
 *   1. the provisioned path: screen 1, 1, screen 2, PIN, screen 3, PIN,
 *      screen 7 (D-1);
 *   2. the returning path with one wrong PIN first: screen 6, E1, PIN,
 *      screen 7.
 *
 * Before Deliverable 4 funds the batch the account screen shows Balance
 * 0.00 USDC and A-1 "No payments received yet"; that is what this test
 * asserts. Writes test-output/ussd-sandbox/<run>/evidence.json, masked.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { captureBanner, createUssdServer, maskMsisdn, recordingListener, ussdConfigFromEnv, type Exchange } from '../../src/index.js';

const enabled = process.env.RUN_AT_SANDBOX_E2E === '1';

describe.skipIf(!enabled)('D3 live: USSD on the Africa\'s Talking sandbox', () => {
  let server: Server | undefined;
  afterAll(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); });

  it('provisioned path, then returning path with one wrong PIN', async () => {
    const env = parseEnv(readFileSync('.env', 'utf8')) as Record<string, string>;
    const cfg = ussdConfigFromEnv(env);
    expect(cfg.callbackPath, 'set USSD_CALLBACK_PATH in .env').toBeTruthy();
    const recipient = process.env.USSD_E2E_MSISDN;
    expect(recipient, 'set USSD_E2E_MSISDN to the Deliverable 2 recipient number').toBeTruthy();

    const run = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join('test-output', 'ussd-sandbox', run);
    mkdirSync(dir, { recursive: true });
    const exchanges: Exchange[] = [];
    const events: string[] = [];
    const { listener } = createUssdServer({ ...cfg, log: (l) => events.push(`${new Date().toISOString()} ${l}`) });
    server = createServer(recordingListener(listener, (e) => exchanges.push(e)));
    await new Promise<void>((r) => server!.listen(Number(env.USSD_PORT ?? 8085), r));
    const { port } = server.address() as AddressInfo;
    console.log(captureBanner(port, cfg.callbackPath, process.env.TUNNEL_BASE_URL));

    const waitMinutes = Number(process.env.USSD_E2E_WAIT_MINUTES ?? 15);
    const deadline = Date.now() + waitMinutes * 60_000;
    const has = (s: string) => events.some((l) => l.includes(s));
    while (!(has('path=provisioned') && has('event=pinRejected') && has('path=returning')) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(has('path=provisioned'), 'provisioned path (screen 7 after PIN setup) observed').toBe(true);
    expect(has('event=pinRejected'), 'one wrong PIN (E1) observed').toBe(true);
    expect(has('path=returning'), 'returning path (screen 7 after PIN entry) observed').toBe(true);

    // a public quick tunnel is scanned by bots; only gateway callbacks carry a session id
    const callbacks = exchanges.filter((e) => e.fields.sessionId);
    const finals = callbacks.filter((e) => e.response.startsWith('END Signed in as'));
    expect(finals.length).toBeGreaterThanOrEqual(2);
    for (const f of finals) {
      expect(f.response).toContain('Balance 0.00 USDC');
      expect(f.response).toContain('No payments received yet');
      expect(f.serverMs).toBeLessThan(8_500);
    }
    const masked = maskMsisdn(recipient!);
    for (const e of callbacks) expect(e.fields.phoneNumber).toBe(masked);
    const serialized = JSON.stringify({ run, port, exchanges: callbacks, events }, null, 2);
    expect(serialized).not.toContain(recipient!);
    expect(serialized).not.toContain(cfg.callbackPath);
    expect(/\d{4}\*|\*\d{4}/.test(callbacks.map((e) => e.fields.text).join('|'))).toBe(false);
    writeFileSync(join(dir, 'evidence.json'), `${serialized}\n`);
    console.log(`evidence written to ${dir}/evidence.json`);
  }, 20 * 60_000);
});
