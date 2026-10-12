#!/usr/bin/env node
/**
 * Capture the Deliverable 1 evidence screenshots from the SDP dashboard:
 * organisation settings (receiver invitations off), wallet providers (User
 * Managed Wallet enabled), the new disbursement form (USDC, phone number
 * and wallet address) and the distribution account (USDC trustline).
 *
 * The script reads the owner password from sdp/.env itself and types it
 * into the dashboard; the password never appears in output or in a
 * screenshot (the login page is not captured after typing).
 *
 * Playwright is a one-off tool, not a dependency of this package:
 *   npm install --no-save playwright && npx playwright install chromium
 *   node scripts/capture-evidence.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dashboardUrlFor, loadEnvFile, sdpConfigFromEnv } from '../dist/index.js';

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
/** --disbursement <id>: capture only that disbursement's page (Deliverable 4). */
const disbursementId = opt('--disbursement');
const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
const tenant = cfg.tenants[0];
const base = dashboardUrlFor(cfg.uiOrigin, tenant.name);
const outDir = 'docs/evidence';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const org = page.getByLabel('Organization name');
  if (await org.count()) { await org.fill(tenant.name); }
  await page.getByLabel('Email address').fill(tenant.ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(tenant.ownerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  const shots = disbursementId
    ? [[`/disbursements/${disbursementId}`, 'd4-disbursement-completed.png'], ['/payments', 'd4-payments.png']]
    : [
        ['/settings', 'd1-settings-invitations-off.png'],
        ['/wallet-providers', 'd1-wallet-providers.png'],
        ['/distribution-account', 'd1-distribution-account.png'],
        ['/disbursements/new', 'd1-new-disbursement-form.png'],
      ];
  for (const [path, file] of shots) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    if (path === '/settings') {
      // the dashboard scrolls inside a container, so bring the toggle into view
      await page.getByText('Disable receiver invitations', { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
    if (path === '/disbursements/new') {
      // best effort: pick the contact method and the asset so the capture
      // shows them; the form is still evidence without it
      const choose = async (test) => {
        for (const sel of await page.locator('select').all()) {
          const options = await sel.locator('option').allTextContents();
          const want = options.find(test);
          if (want) { try { await sel.selectOption({ label: want }); return; } catch { /* leave as is */ } }
        }
      };
      await choose((o) => /wallet address/i.test(o) && /phone/i.test(o));
      await page.waitForTimeout(1000);
      await choose((o) => /USDC/i.test(o));
      await page.waitForTimeout(800);
    }
    if (file.startsWith('d4-')) {
      // the dashboard scrolls inside a container: capture the viewport, then the lower part
      await page.screenshot({ path: `${outDir}/${file}` });
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outDir}/${file.replace('.png', '-2.png')}` });
      console.log(`captured ${file} and its second page (${path})`);
      continue;
    }
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
    console.log(`captured ${file} (${path})`);
  }
} finally {
  await browser.close();
}
