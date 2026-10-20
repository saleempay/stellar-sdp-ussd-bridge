import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Account, BASE_FEE, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalKeypairSigner } from 'stellar-ussd-sep10-adapter';
import {
  SIGNER_METHODS,
  SIGNER_MODULE_ENV,
  SignerConfigError,
  assertSigner,
  loadInjectedSigner,
  sponsorSigning,
  envelopeHash,
  envelopeSignedBy,
  selfTestEnvelope,
  selfTestEnabled,
  SELF_TEST_MAX_TIME,
} from '../../src/signer/injected.js';
import { createUssdServer, ussdConfigFromEnv } from '../../src/ussd/server.js';
import { FakeSigner } from './provisionFakes.js';

const repo = resolve(process.cwd());
const FIXTURE = './test/fixtures/fake-signer.mjs';
const SPONSOR = Keypair.random();

describe('assertSigner: the boot check against the adapter Signer interface', () => {
  it('accepts an object with the three methods', () => {
    const fake = new FakeSigner();
    expect(assertSigner(fake, 'test')).toBe(fake);
    expect(assertSigner(new LocalKeypairSigner(), 'test')).toBeInstanceOf(LocalKeypairSigner);
  });

  for (const method of SIGNER_METHODS) {
    it(`refuses an object missing ${method}, naming it`, () => {
      const partial: Record<string, unknown> = { createAccountKey: async () => 'G', canSignFor: async () => true, signTransaction: async (x: string) => x };
      delete partial[method];
      expect(() => assertSigner(partial, 'origin')).toThrow(SignerConfigError);
      expect(() => assertSigner(partial, 'origin')).toThrow(new RegExp(`origin: .*missing or not a function: ${method}`));
    });
  }

  it('refuses a member that is not a function, null, a string and undefined', () => {
    expect(() => assertSigner({ createAccountKey: 'x', canSignFor: async () => true, signTransaction: async (x: string) => x }, 'o')).toThrow(/createAccountKey/);
    expect(() => assertSigner(null, 'o')).toThrow(/got null/);
    expect(() => assertSigner('signer', 'o')).toThrow(/got string/);
    expect(() => assertSigner(undefined, 'o')).toThrow(/got undefined/);
  });
});

describe('loadInjectedSigner', () => {
  it('returns undefined when BRIDGE_SIGNER_MODULE is unset or blank (the reference signer stays the default)', async () => {
    expect(await loadInjectedSigner({})).toBeUndefined();
    expect(await loadInjectedSigner({ BRIDGE_SIGNER_MODULE: '  ' })).toBeUndefined();
  });

  it('imports the module relative to the working directory and calls its createSigner factory', async () => {
    process.env.FAKE_SIGNER_SPONSOR = SPONSOR.publicKey();
    const signer = await loadInjectedSigner({ BRIDGE_SIGNER_MODULE: FIXTURE }, { cwd: repo });
    expect(signer).toBeDefined();
    expect(await signer!.canSignFor(SPONSOR.publicKey())).toBe(true);
    expect(await signer!.canSignFor('G'.padEnd(56, 'Z'))).toBe(false);
  });

  it('honours BRIDGE_SIGNER_EXPORT and refuses an export that is not a signer, naming the missing members', async () => {
    const err = await loadInjectedSigner({ BRIDGE_SIGNER_MODULE: FIXTURE, BRIDGE_SIGNER_EXPORT: 'notASigner' }, { cwd: repo }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignerConfigError);
    expect((err as Error).message).toContain('export "notASigner"');
    expect((err as Error).message).toContain('canSignFor, signTransaction');
  });

  it('refuses a module without the expected exports, and a module that cannot be imported', async () => {
    const importer = async () => ({ somethingElse: 1 });
    await expect(loadInjectedSigner({ BRIDGE_SIGNER_MODULE: 'x' }, { importer })).rejects.toThrow(/exports none of createSigner, default/);
    await expect(loadInjectedSigner({ BRIDGE_SIGNER_MODULE: './does-not-exist.mjs' }, { cwd: repo })).rejects.toThrow(/cannot import the signer module/);
  });

  it('accepts a default export that is the signer object itself, and an async factory', async () => {
    const fake = new FakeSigner();
    expect(await loadInjectedSigner({ BRIDGE_SIGNER_MODULE: 'm' }, { importer: async () => ({ default: fake }) })).toBe(fake);
    expect(await loadInjectedSigner({ BRIDGE_SIGNER_MODULE: 'm' }, { importer: async () => ({ default: async () => fake }) })).toBe(fake);
  });
});

describe('sponsorSigning', () => {
  it('default: the reference signer imports the sponsor secret and the public key must match when set', async () => {
    const s = await sponsorSigning({ SPONSOR_SECRET_KEY: SPONSOR.secret() });
    expect(s.injected).toBe(false);
    expect(s.sponsorPublicKey).toBe(SPONSOR.publicKey());
    expect(await s.signer.canSignFor(SPONSOR.publicKey())).toBe(true);
    await expect(sponsorSigning({ SPONSOR_SECRET_KEY: SPONSOR.secret(), SPONSOR_PUBLIC_KEY: Keypair.random().publicKey() })).rejects.toThrow(/does not match/);
    await expect(sponsorSigning({})).rejects.toThrow(/SPONSOR_SECRET_KEY missing/);
    await expect(sponsorSigning({ SPONSOR_SECRET_KEY: 'not-a-seed' })).rejects.toThrow(/not a valid secret key/);
  });

  it('injected: needs the sponsor public key, no secret in the environment, and a signer that can sign for the sponsor', async () => {
    const fake = new FakeSigner();
    const sponsor = SPONSOR.publicKey();
    await expect(sponsorSigning({}, fake)).rejects.toThrow(/SPONSOR_PUBLIC_KEY is required/);
    await expect(sponsorSigning({ SPONSOR_PUBLIC_KEY: sponsor, SPONSOR_SECRET_KEY: SPONSOR.secret() }, fake)).rejects.toThrow(/must not be set when a signer is injected/);
    const cannot = Object.assign(new FakeSigner(), { canSignFor: async () => false });
    const err = await sponsorSigning({ SPONSOR_PUBLIC_KEY: sponsor }, cannot).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignerConfigError);
    expect((err as Error).message).toContain('cannot sign for the sponsor account');
    expect((err as Error).message).not.toContain(sponsor);
    const ok = await sponsorSigning({ SPONSOR_PUBLIC_KEY: sponsor }, Object.assign(new FakeSigner(), { canSignFor: async (a: string) => a === sponsor }));
    expect(ok.injected).toBe(true);
    expect(ok.sponsorPublicKey).toBe(sponsor);
  });

  it('injected: the object is checked against the interface first', async () => {
    await expect(sponsorSigning({ SPONSOR_PUBLIC_KEY: SPONSOR.publicKey() }, { canSignFor: async () => true } as never)).rejects.toThrow(/missing or not a function: createAccountKey, signTransaction/);
  });
});

describe('sponsorSigning self-test: the signature is checked, not reported (review of 13 October, minor; ruling of 18 October)', () => {
  const PASSPHRASE = 'Test SDF Network ; September 2015';
  const signingWith = (kp: Keypair) => ({
    async createAccountKey() { return Keypair.random().publicKey(); },
    async canSignFor(id: string) { return id === SPONSOR.publicKey(); },
    async signTransaction(xdr: string, opts: { networkPassphrase: string }) { const tx = TransactionBuilder.fromXDR(xdr, opts.networkPassphrase); tx.sign(kp); return tx.toXDR(); },
  });
  const env = { SPONSOR_PUBLIC_KEY: SPONSOR.publicKey() };
  const on = { networkPassphrase: PASSPHRASE, selfTest: true };

  it('passes when the injected signer signs the throwaway envelope with the sponsor key; the result carries no signature', async () => {
    const r = await sponsorSigning(env, signingWith(SPONSOR), on);
    expect(r.injected).toBe(true);
    expect(r.selfTested).toBe(true);
    expect(Object.keys(r).sort()).toEqual(['injected', 'selfTested', 'signer', 'sponsorPublicKey']);
  });

  it('refuses a signer that claims the sponsor but signs with another key, one that returns the envelope unsigned, and one that throws', async () => {
    await expect(sponsorSigning(env, signingWith(Keypair.random()), on)).rejects.toThrow(/does not verify against SPONSOR_PUBLIC_KEY/);
    const unsigned = { ...signingWith(SPONSOR), async signTransaction(xdr: string) { return xdr; } };
    await expect(sponsorSigning(env, unsigned, on)).rejects.toThrow(/does not verify against SPONSOR_PUBLIC_KEY/);
    const throwing = { ...signingWith(SPONSOR), async signTransaction() { throw new Error('hsm offline'); } };
    await expect(sponsorSigning(env, throwing, on)).rejects.toThrow(/failed to sign the self-test envelope: hsm offline/);
  });

  it('a signer that returns a different envelope, even one correctly signed by the sponsor, is refused on the hash before any signature is checked (fix round 3)', async () => {
    const substituting = {
      ...signingWith(SPONSOR),
      async signTransaction(_xdr: string, opts: { networkPassphrase: string }) {
        const other = new TransactionBuilder(new Account(SPONSOR.publicKey(), '-1'), { fee: BASE_FEE, networkPassphrase: opts.networkPassphrase })
          .addOperation(Operation.manageData({ name: 'substituted', value: 'x' })).setTimebounds(0, 1).build();
        other.sign(SPONSOR);
        expect(envelopeSignedBy(other.toXDR(), SPONSOR.publicKey(), opts.networkPassphrase)).toBe(true);
        return other.toXDR();
      },
    };
    await expect(sponsorSigning(env, substituting, on)).rejects.toThrow(/returned a different envelope than the self-test sent it \(transaction hash mismatch\)/);
    const sent = selfTestEnvelope(SPONSOR.publicKey(), PASSPHRASE);
    const signedSame = await signingWith(SPONSOR).signTransaction(sent, { networkPassphrase: PASSPHRASE });
    expect(envelopeHash(signedSame, PASSPHRASE)).toBe(envelopeHash(sent, PASSPHRASE));
  });

  it('off, the self-test is skipped and the signer is never asked to sign; the reference signer never self-tests', async () => {
    let signCalls = 0;
    const counting = { ...signingWith(Keypair.random()), async signTransaction(xdr: string) { signCalls += 1; return xdr; } };
    const r = await sponsorSigning(env, counting, { networkPassphrase: PASSPHRASE, selfTest: false });
    expect(r.selfTested).toBe(false);
    expect(signCalls).toBe(0);
    await expect(sponsorSigning(env, counting, { selfTest: true })).rejects.toThrow(/needs the network passphrase/);
    const ref = await sponsorSigning({ SPONSOR_SECRET_KEY: SPONSOR.secret() }, undefined, on);
    expect(ref.injected).toBe(false);
    expect(ref.selfTested).toBe(false);
  });

  it('BRIDGE_SIGNER_SELF_TEST: unset is on, on every network (ruling of 19 October); off is the explicit exception; anything else is refused', () => {
    expect(selfTestEnabled({})).toBe(true);
    expect(selfTestEnabled({ BRIDGE_SIGNER_SELF_TEST: '' })).toBe(true);
    expect(selfTestEnabled({ BRIDGE_SIGNER_SELF_TEST: 'on' })).toBe(true);
    expect(selfTestEnabled({ BRIDGE_SIGNER_SELF_TEST: ' OFF ' })).toBe(false);
    expect(() => selfTestEnabled({ BRIDGE_SIGNER_SELF_TEST: 'yes' })).toThrow(SignerConfigError);
  });

  it('the envelope can never be submitted: sequence number 0, maxTime in the past, one ManageData operation; envelopeSignedBy needs a signature over the hash by that key', () => {
    const xdr = selfTestEnvelope(SPONSOR.publicKey(), PASSPHRASE);
    const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
    expect('sequence' in tx ? tx.sequence : '').toBe('0');
    expect('timeBounds' in tx ? tx.timeBounds : undefined).toEqual({ minTime: '0', maxTime: String(SELF_TEST_MAX_TIME) });
    expect(Number(SELF_TEST_MAX_TIME)).toBeLessThan(Date.now() / 1000);
    expect('operations' in tx ? tx.operations.map((o) => o.type) : []).toEqual(['manageData']);
    expect(envelopeSignedBy(xdr, SPONSOR.publicKey(), PASSPHRASE)).toBe(false);
  });
});

describe('createUssdServer with an injected signer', () => {
  const env = { USSD_CALLBACK_PATH: '/ussd/test-only-path', USSD_CREATE_ON_DIAL: 'true', SPONSOR_PUBLIC_KEY: SPONSOR.publicKey() };

  it('uses the injected signer when given with the sponsor public key', () => {
    const cfg = { ...ussdConfigFromEnv(env), signer: new FakeSigner() };
    expect(typeof createUssdServer(cfg).machine.createAccount).toBe('function');
  });

  it('refuses an injected object that does not implement the interface', () => {
    const cfg = { ...ussdConfigFromEnv(env), signer: { canSignFor: async () => true } as never };
    expect(() => createUssdServer(cfg)).toThrow(/UssdServerConfig.signer: .*missing or not a function/);
  });

  it('refuses an injected signer without the sponsor public key', () => {
    const cfg = { ...ussdConfigFromEnv({ ...env, SPONSOR_PUBLIC_KEY: undefined }), signer: new FakeSigner() };
    expect(() => createUssdServer(cfg)).toThrow(/SPONSOR_PUBLIC_KEY is not set/);
  });

  it('default path unchanged: the reference signer over the sponsor secret', () => {
    const cfg = ussdConfigFromEnv({ ...env, SPONSOR_PUBLIC_KEY: undefined, SPONSOR_SECRET_KEY: SPONSOR.secret() });
    expect(typeof createUssdServer(cfg).machine.createAccount).toBe('function');
    expect(() => createUssdServer(ussdConfigFromEnv({ ...env, SPONSOR_SECRET_KEY: Keypair.random().secret() }))).toThrow(/does not match/);
  });
});

describe('scripts/provision.mjs refuses a bad injected signer at boot, before any network call', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function scratch(envLines: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-signer-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.env'), `${envLines.join('\n')}\n`);
    writeFileSync(join(dir, 'in.csv'), 'phone,id,amount\n+999700000001,r1,1\n');
    mkdirSync(join(dir, 'fixtures'));
    copyFileSync(join(repo, 'test', 'fixtures', 'fake-signer.mjs'), join(dir, 'fixtures', 'fake-signer.mjs'));
    copyFileSync(join(repo, 'test', 'fixtures', 'importing-signer.mjs'), join(dir, 'fixtures', 'importing-signer.mjs'));
    return dir;
  }
  const run = (dir: string, extraEnv: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(repo, 'scripts', 'provision.mjs'), '--input', 'in.csv', '--output', 'out.csv', '--data', 'data'], {
      cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HORIZON_URL: 'https://horizon-testnet.stellar.org', ...extraEnv },
    });

  it('an export that is not a signer: exit 2, missing members named, nothing written', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/fake-signer.mjs', 'BRIDGE_SIGNER_EXPORT=notASigner']);
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('missing or not a function: canSignFor, signTransaction');
  });

  it('a signer that cannot sign for the sponsor: exit 2', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/fake-signer.mjs']);
    const r = run(dir, { FAKE_SIGNER_SPONSOR: Keypair.random().publicKey() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot sign for the sponsor account');
  });

  it('a sponsor secret next to an injected signer: exit 2', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, `SPONSOR_SECRET_KEY=${SPONSOR.secret()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/fake-signer.mjs']);
    const r = run(dir, { FAKE_SIGNER_SPONSOR: SPONSOR.publicKey() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('must not be set when a signer is injected');
    expect(r.stderr).not.toContain(SPONSOR.secret());
  });

  it('the signer module is imported only after the network has been accepted: a refused network leaves it never imported (review of 13 October, finding 2)', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/importing-signer.mjs', 'NETWORK_TYPE=othernet']);
    const r = run(dir, { FAKE_SIGNER_SPONSOR: SPONSOR.publicKey() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('network configuration refused');
    expect(r.stderr).toContain('BRIDGE_ACKNOWLEDGE_REAL_FUNDS');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(false);
  });

  it('the network assertion reads the same merged environment as the signer: NETWORK_TYPE from the shell alone is honoured', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/importing-signer.mjs']);
    const r = run(dir, { FAKE_SIGNER_SPONSOR: SPONSOR.publicKey(), NETWORK_TYPE: 'othernet' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('network configuration refused');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(false);
  });

  it('on an accepted network the signer module is imported and its checks still run before any network call', () => {
    const dir = scratch([`SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/importing-signer.mjs']);
    const r = run(dir, { FAKE_SIGNER_SPONSOR: Keypair.random().publicKey() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot sign for the sponsor account');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(true);
  });
});

describe('scripts/provision.mjs: the signer module is imported only after the live Horizon check (fix round 3, 19 October)', () => {
  const dirs: string[] = [];
  const children: Array<ReturnType<typeof spawn>> = [];
  afterEach(() => { for (const c of children.splice(0)) c.kill(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const OTHER_PASSPHRASE = 'Other Network ; Example Only';
  const networkLines = (horizonUrl: string) => [
    'NETWORK_TYPE=othernet', `NETWORK_PASSPHRASE=${OTHER_PASSPHRASE}`, `HORIZON_URL=${horizonUrl}`,
    `ASSET_ISSUER=${'G'.padEnd(56, 'A')}`, 'EXPLORER_BASE_URL=https://explorer.example.test/other', 'BRIDGE_ACKNOWLEDGE_REAL_FUNDS=yes',
  ];
  function scratch(horizonUrl: string) {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-signer-order-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.env'), `${[...networkLines(horizonUrl), `SPONSOR_PUBLIC_KEY=${SPONSOR.publicKey()}`, 'BRIDGE_SIGNER_MODULE=./fixtures/importing-signer.mjs'].join('\n')}\n`);
    mkdirSync(join(dir, 'sdp'));
    writeFileSync(join(dir, 'sdp', '.env'), `${networkLines(horizonUrl).join('\n')}\n`);
    writeFileSync(join(dir, 'in.csv'), 'phone,id,amount\n+999700000001,r1,1\n');
    mkdirSync(join(dir, 'fixtures'));
    copyFileSync(join(repo, 'test', 'fixtures', 'importing-signer.mjs'), join(dir, 'fixtures', 'importing-signer.mjs'));
    return dir;
  }
  /** A fake Horizon root in a child process (spawnSync would block the event loop an in-process server needs). */
  async function fakeHorizon(passphrase: string): Promise<string> {
    const code = `const s=require('node:http').createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({network_passphrase:${JSON.stringify(passphrase)}}))});s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)+'\\n'));`;
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
    children.push(child);
    const port = await new Promise<string>((resolve) => child.stdout!.once('data', (d) => resolve(String(d).trim())));
    return `http://127.0.0.1:${port}`;
  }
  const run = (dir: string) => new Promise<{ status: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [join(repo, 'scripts', 'provision.mjs'), '--input', 'in.csv', '--output', 'out.csv', '--data', 'data'], {
      cwd: dir, env: { PATH: process.env.PATH ?? '', FAKE_SIGNER_SPONSOR: Keypair.random().publicKey() }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', (d) => { stderr += String(d); });
    child.on('close', (status) => resolve({ status, stderr }));
  });

  it('a Horizon that does not answer refuses the run and the signer module is never imported', async () => {
    const dir = scratch('http://127.0.0.1:1');
    const r = await run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HORIZON_URL root did not answer');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(false);
  });

  it('a Horizon that serves another passphrase refuses the run and the signer module is never imported', async () => {
    const dir = scratch(await fakeHorizon('Test SDF Network ; September 2015'));
    const r = await run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HORIZON_URL serves a different network than NETWORK_PASSPHRASE names');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(false);
  });

  it('a Horizon that confirms the passphrase lets the signer load, and its checks still run before any transaction', async () => {
    const dir = scratch(await fakeHorizon(OTHER_PASSPHRASE));
    const r = await run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot sign for the sponsor account');
    expect(existsSync(join(dir, 'signer-module-imported.txt'))).toBe(true);
  });
});
