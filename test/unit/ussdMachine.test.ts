import { describe, expect, it } from 'vitest';
import { InMemoryAccountStore, InMemoryPinStore, InMemorySessionStore, verifyPin, type GatewayStep } from 'stellar-ussd-sep10-adapter';
import { AccountNotOnChainError, NoUsdcTrustlineError, SCREENS, handleBridgeStep, type AccountView, type BridgeMachineDeps } from '../../src/ussd/index.js';

const MSISDN = '+254738035311';
const ACCOUNT = 'G'.padEnd(56, 'Q');
const PIN = '4729';
const OTHER_PIN = '8351';
const NOW = Date.parse('2026-10-07T12:00:00Z');

function setup(opts: { account?: string; pin?: string; createOnDial?: boolean; view?: AccountView | Error } = {}) {
  const sessions = new InMemorySessionStore();
  const pins = new InMemoryPinStore();
  const accounts = new InMemoryAccountStore();
  const logs: string[] = [];
  const created: string[] = [];
  const deps: BridgeMachineDeps = {
    sessions, pins, accounts,
    loadView: async () => { if (opts.view instanceof Error) throw opts.view; return opts.view ?? { balance: '0.0000000' }; },
    msisdn: { defaultCountryCode: '254' },
    now: () => NOW,
    log: (l) => logs.push(l),
  };
  if (opts.createOnDial !== false) deps.createAccount = async (m) => { created.push(m); await accounts.put(m, ACCOUNT); return { accountId: ACCOUNT, creationTxHash: 'ab'.repeat(32) }; };
  const ready = (async () => {
    if (opts.account) await accounts.put(MSISDN, opts.account);
    if (opts.pin) { const { establishPin } = await import('stellar-ussd-sep10-adapter'); await establishPin({ store: pins }, MSISDN, opts.pin); }
  })();
  /** Drive a session: each call carries the cumulative inputs like the gateway does. */
  const dial = (sessionId = 's1') => {
    const inputs: string[] = [];
    return async (input?: string) => {
      await ready;
      if (input !== undefined) inputs.push(input);
      const step: GatewayStep = { sessionId, msisdnRaw: MSISDN, inputs: [...inputs], rawText: inputs.join('*') };
      return handleBridgeStep(deps, step);
    };
  };
  return { deps, pins, accounts, logs, created, dial };
}
const texts = (...s: Array<{ text: string }>) => s.map((x) => x.text);

describe('entry state: account and PIN (returning user)', () => {
  it('screen 1, 6, then 7 with balance and last received', async () => {
    const f = setup({ account: ACCOUNT, pin: PIN, view: { balance: '12.5000000', lastReceived: { amount: '10.0000000', createdAt: '2026-10-24T09:00:00Z' } } });
    const s = f.dial();
    expect((await s()).text).toBe(SCREENS.mainMenu().text);
    expect((await s('1')).text).toBe('Enter your PIN');
    const final = await s(PIN);
    expect(final.kind).toBe('end');
    expect(final.text).toBe(`Signed in as GQQQ..QQQQ\nBalance 12.50 USDC\nLast received 10.00 USDC, 24 Oct\nTest only, no funds move`);
    expect(f.logs.some((l) => l.includes('event=accountScreen path=returning'))).toBe(true);
    expect(f.created).toEqual([]);
  });

  it('a wrong PIN shows E1 with the countdown, the third locks with E2 (adapter policy)', async () => {
    const f = setup({ account: ACCOUNT, pin: PIN });
    const s = f.dial();
    await s(); await s('1');
    expect((await s(OTHER_PIN)).text).toBe('Wrong PIN. 2 attempts left\nEnter your PIN');
    expect((await s(OTHER_PIN)).text).toBe('Wrong PIN. 1 attempt left\nEnter your PIN');
    const locked = await s(OTHER_PIN);
    expect(locked.text).toBe('Too many attempts.\nTry again later.');
    expect(locked.kind).toBe('end');
    // a new session while locked is refused before any hashing
    const t = f.dial('s2');
    await t(); await t('1');
    expect((await t(PIN)).text).toBe('Too many attempts.\nTry again later.');
  });

  it('a malformed PIN entry re-prompts (A-6) without counting an attempt', async () => {
    const f = setup({ account: ACCOUNT, pin: PIN });
    const s = f.dial();
    await s(); await s('1');
    expect((await s('12')).text).toBe('PIN must be exactly 4 digits\nEnter your PIN');
    expect((await s(PIN)).kind).toBe('end');
  });
});

describe('entry state: account, no PIN (a Deliverable 2 recipient)', () => {
  it('screens 2 and 3, then 7 directly; screens 4 and 5 are skipped (D-1); no account is created', async () => {
    const f = setup({ account: ACCOUNT, view: { balance: '0.0000000' } });
    const s = f.dial();
    await s();
    expect((await s('1')).text).toBe('Create a 4 digit PIN');
    expect((await s(PIN)).text).toBe('Enter the PIN again');
    const final = await s(PIN);
    expect(final.kind).toBe('end');
    expect(final.text).toBe(`Signed in as GQQQ..QQQQ\nBalance 0.00 USDC\nNo payments received yet\nTest only, no funds move`);
    expect(f.created).toEqual([]);
    expect(f.logs.some((l) => l.includes('event=accountScreen path=provisioned'))).toBe(true);
    const record = await f.pins.get(MSISDN);
    expect(record?.hash).toMatch(/^scrypt\$/);
    expect(await verifyPin(PIN, record!.hash)).toBe(true);
  });

  it('then the returning path works with that PIN', async () => {
    const f = setup({ account: ACCOUNT });
    const s = f.dial();
    await s(); await s('1'); await s(PIN); await s(PIN);
    const t = f.dial('s2');
    await t();
    expect((await t('1')).text).toBe('Enter your PIN');
    expect((await t(PIN)).kind).toBe('end');
  });

  it('a stored PIN is never replaced: setup is not reachable once a record exists', async () => {
    const f = setup({ account: ACCOUNT, pin: PIN });
    const s = f.dial();
    await s();
    const before = (await f.pins.get(MSISDN))!.hash;
    expect((await s('1')).text).toBe('Enter your PIN');
    await s(OTHER_PIN);
    expect((await f.pins.get(MSISDN))!.hash).toBe(before);
  });

  it('mismatch (A-5), bad format (A-3) and weak (A-4) re-prompt without storing anything', async () => {
    const f = setup({ account: ACCOUNT });
    const s = f.dial();
    await s(); await s('1');
    expect((await s('12')).text).toBe('PIN must be exactly 4 digits\nCreate a 4 digit PIN');
    expect((await s('1234')).text).toBe('That PIN is too easy to guess\nChoose a less obvious one');
    expect((await s(PIN)).text).toBe('Enter the PIN again');
    expect((await s(OTHER_PIN)).text).toBe('PINs did not match\nCreate a 4 digit PIN');
    expect(await f.pins.get(MSISDN)).toBeUndefined();
    expect((await s(PIN)).text).toBe('Enter the PIN again');
    expect((await s(PIN)).kind).toBe('end');
  });
});

describe('entry state: no account, no PIN (first use)', () => {
  it('screens 2, 3, 4 (PIN saved), creation on 1, screen 5, PIN, then 7', async () => {
    const f = setup({ view: { balance: '0.0000000' } });
    const s = f.dial();
    await s(); await s('1'); await s(PIN);
    expect((await s(PIN)).text).toBe('PIN saved\n1. Create your account and continue');
    expect((await s('9')).text).toBe('Invalid choice\nPIN saved\n1. Create your account and continue');
    expect((await s('1')).text).toBe('Account ready\nEnter your PIN');
    expect(f.created).toEqual([MSISDN]);
    const final = await s(PIN);
    expect(final.kind).toBe('end');
    expect(final.text).toContain('Signed in as GQQQ..QQQQ');
  });

  it('with creation on dial off, E3 is shown and nothing is created', async () => {
    const f = setup({ createOnDial: false });
    const s = f.dial();
    await s();
    const e3 = await s('1');
    expect(e3.text).toBe('No account found for this number.\nDial again to set up.');
    expect(e3.kind).toBe('end');
    expect(await f.pins.get(MSISDN)).toBeUndefined();
  });

  it('creation failure shows E4', async () => {
    const f = setup();
    f.deps.createAccount = async () => { throw Object.assign(new Error('boom'), { code: 'TRANSACTION_FAILED' }); };
    const s = f.dial();
    await s(); await s('1'); await s(PIN); await s(PIN);
    expect((await s('1')).text).toBe('Service unavailable.\nPlease try again later.');
  });
});

describe('PIN exists but no account mapped (A-8, issue #9 wording)', () => {
  it('verifies the PIN first and says PIN accepted, never PIN saved', async () => {
    const f = setup({ pin: PIN, view: { balance: '0.0000000' } });
    const s = f.dial();
    await s(); await s('1');
    expect((await s(PIN)).text).toBe('PIN accepted\n1. Create your account and continue');
    expect((await s('2')).text).toBe('Invalid choice\nPIN accepted\n1. Create your account and continue');
    expect((await s('1')).text).toBe('Account ready\nEnter your PIN');
  });
  it('with creation off, E3', async () => {
    const f = setup({ pin: PIN, createOnDial: false });
    const s = f.dial();
    await s();
    expect((await s('1')).text).toBe('No account found for this number.\nDial again to set up.');
  });
});

describe('account screen errors and other screens', () => {
  it('maps the view errors to E3, A-9 and E4', async () => {
    for (const [err, text] of [
      [new AccountNotOnChainError(ACCOUNT), 'No account found for this number.\nDial again to set up.'],
      [new NoUsdcTrustlineError(ACCOUNT), 'Your account cannot hold USDC yet.\nTry again later.'],
      [new Error('Horizon loadAccount did not answer within 2500 ms'), 'Service unavailable.\nPlease try again later.'],
    ] as Array<[Error, string]>) {
      const f = setup({ account: ACCOUNT, pin: PIN, view: err });
      const s = f.dial();
      await s(); await s('1');
      const final = await s(PIN);
      expect(final.text).toBe(text);
      expect(final.kind).toBe('end');
    }
  });

  it('2 on the main menu shows About and ends; another input is an invalid choice (A-2)', async () => {
    const f = setup();
    const s = f.dial();
    await s();
    expect((await s('7')).text).toBe('Invalid choice\nSaleem\n1. My account\n2. About');
    const t = f.dial('s2');
    await t();
    const about = await t('2');
    expect(about.text).toBe('Saleem, a payment service for basic phones.\nsaleem.digital\nTest only, no funds move');
    expect(about.kind).toBe('end');
  });

  it('inputs for an unknown session get E5; a duplicate callback re-prompts the current screen', async () => {
    const f = setup({ account: ACCOUNT, pin: PIN });
    const unknown = await handleBridgeStep(f.deps, { sessionId: 'gone', msisdnRaw: MSISDN, inputs: ['1'], rawText: '1' });
    expect(unknown.text).toBe('The session has expired');
    const s = f.dial();
    await s(); await s('1');
    const dup = await handleBridgeStep(f.deps, { sessionId: 's1', msisdnRaw: MSISDN, inputs: ['1'], rawText: '1' });
    expect(dup.text).toBe('Enter your PIN');
  });

  it('never logs a PIN digit sequence and masks PIN positions in the session history', async () => {
    const f = setup({ account: ACCOUNT });
    const s = f.dial();
    await s(); await s('1'); await s(PIN); await s(PIN);
    expect(f.logs.join('\n')).not.toContain(PIN);
    const session = await f.deps.sessions.get('s1', NOW);
    expect(session?.maskedHistory).toEqual(['1', '####', '####']);
  });
});
