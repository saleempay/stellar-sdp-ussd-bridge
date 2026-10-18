import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalKeypairSigner } from 'stellar-ussd-sep10-adapter';
import {
  SIGNER_METHODS,
  SIGNER_MODULE_ENV,
  SignerConfigError,
  assertSigner,
  loadInjectedSigner,
  sponsorSigning,
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
    writeFileSync(join(dir, 'in.csv'), 'phone,id,amount\n+254700000001,r1,1\n');
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
