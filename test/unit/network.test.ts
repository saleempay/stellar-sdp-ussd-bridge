import { describe, expect, it } from 'vitest';
import { fakeFetch } from './helpers.js';
import { TESTNET_EXPLORER_BASE_URL, TESTNET_HORIZON_URL, TESTNET_NETWORK_PASSPHRASE, TESTNET_USDC_ISSUER } from '../../src/sdp/facts.js';
import {
  NETWORK_ENV,
  NetworkConfigError,
  REAL_FUNDS_ACK_ENV,
  TESTNET_FACTS,
  assertNetwork,
  explorerAccountUrl,
  explorerTxUrl,
  networkFacts,
  networkTypeOf,
  verifyHorizonNetwork,
  assertSameNetwork,
} from '../../src/sdp/network.js';

/** Made-up values for a network that is not testnet; nothing here names a real network. */
const OTHER = {
  NETWORK_TYPE: 'othernet',
  NETWORK_PASSPHRASE: 'Other Network ; Example Only',
  HORIZON_URL: 'https://horizon.example.test',
  ASSET_ISSUER: 'G'.padEnd(56, 'A'),
  EXPLORER_BASE_URL: 'https://explorer.example.test/other',
  BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes',
};

const refusal = (env: Record<string, string | undefined>): NetworkConfigError => {
  try {
    assertNetwork(env);
  } catch (e) {
    expect(e).toBeInstanceOf(NetworkConfigError);
    return e as NetworkConfigError;
  }
  throw new Error('expected a refusal');
};

describe('networkFacts: the reader', () => {
  it('with nothing set, every value is the testnet constant', () => {
    expect(networkFacts({})).toEqual(TESTNET_FACTS);
    expect(networkTypeOf({})).toBe('testnet');
  });

  it('the testnet constants are the only literals it knows', () => {
    expect(TESTNET_FACTS).toEqual({
      networkType: 'testnet',
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
      horizonUrl: TESTNET_HORIZON_URL,
      assetIssuer: TESTNET_USDC_ISSUER,
      explorerBaseUrl: TESTNET_EXPLORER_BASE_URL,
    });
  });

  it('NETWORK_TYPE=testnet (any case, padded) fills unset values with the testnet constants', () => {
    expect(networkFacts({ NETWORK_TYPE: ' TestNet ' })).toEqual(TESTNET_FACTS);
  });

  it('on another network an unset value stays empty rather than taking a testnet default', () => {
    const f = networkFacts({ NETWORK_TYPE: 'othernet', HORIZON_URL: OTHER.HORIZON_URL });
    expect(f.networkType).toBe('othernet');
    expect(f.horizonUrl).toBe(OTHER.HORIZON_URL);
    expect(f.networkPassphrase).toBe('');
    expect(f.assetIssuer).toBe('');
    expect(f.explorerBaseUrl).toBe('');
  });

  it('explorer links come from the configured base, trailing slash tolerated', () => {
    const f = { ...TESTNET_FACTS, explorerBaseUrl: 'https://explorer.example.test/x/' };
    expect(explorerTxUrl(f, 'abc')).toBe('https://explorer.example.test/x/tx/abc');
    expect(explorerAccountUrl(f, 'GABC')).toBe('https://explorer.example.test/x/account/GABC');
    expect(explorerTxUrl(TESTNET_FACTS, 'abc')).toBe(`${TESTNET_EXPLORER_BASE_URL}/tx/abc`);
  });
});

describe('assertNetwork on testnet', () => {
  it('passes with nothing set and with every value explicitly the testnet constant', () => {
    expect(assertNetwork({})).toEqual(TESTNET_FACTS);
    expect(assertNetwork({
      NETWORK_TYPE: 'testnet',
      NETWORK_PASSPHRASE: TESTNET_NETWORK_PASSPHRASE,
      HORIZON_URL: TESTNET_HORIZON_URL,
      ASSET_ISSUER: TESTNET_USDC_ISSUER,
      EXPLORER_BASE_URL: TESTNET_EXPLORER_BASE_URL,
    })).toEqual(TESTNET_FACTS);
  });

  it('ignores the acknowledgement on testnet', () => {
    expect(assertNetwork({ BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes' })).toEqual(TESTNET_FACTS);
  });

  for (const key of ['networkPassphrase', 'horizonUrl', 'assetIssuer', 'explorerBaseUrl'] as const) {
    it(`refuses when ${NETWORK_ENV[key]} is set to something other than the testnet value, naming it`, () => {
      const err = refusal({ [NETWORK_ENV[key]]: OTHER[NETWORK_ENV[key] as keyof typeof OTHER] });
      expect(err.reasons).toEqual([`${NETWORK_ENV[key]} does not equal the testnet value`]);
      expect(err.message).not.toContain(OTHER.HORIZON_URL);
    });
  }

  it('names every mismatched value at once', () => {
    const err = refusal({ HORIZON_URL: OTHER.HORIZON_URL, ASSET_ISSUER: OTHER.ASSET_ISSUER });
    expect(err.reasons).toHaveLength(2);
    expect(err.reasons.join(' ')).toContain('HORIZON_URL');
    expect(err.reasons.join(' ')).toContain('ASSET_ISSUER');
  });
});

describe('assertNetwork on a network other than testnet', () => {
  it('passes only when every value is supplied, none is a testnet value, and the acknowledgement reads yes', () => {
    const f = assertNetwork(OTHER);
    expect(f).toEqual({
      networkType: 'othernet',
      networkPassphrase: OTHER.NETWORK_PASSPHRASE,
      horizonUrl: OTHER.HORIZON_URL,
      assetIssuer: OTHER.ASSET_ISSUER,
      explorerBaseUrl: OTHER.EXPLORER_BASE_URL,
    });
  });

  for (const key of ['NETWORK_PASSPHRASE', 'HORIZON_URL', 'ASSET_ISSUER', 'EXPLORER_BASE_URL'] as const) {
    it(`refuses when ${key} is missing, naming it`, () => {
      const { [key]: _omit, ...rest } = OTHER;
      const err = refusal(rest);
      expect(err.reasons).toEqual([`${key} is not set (required for network type "othernet")`]);
    });

    it(`refuses when ${key} is blank, naming it`, () => {
      const err = refusal({ ...OTHER, [key]: '   ' });
      expect(err.reasons).toEqual([`${key} is not set (required for network type "othernet")`]);
    });
  }

  const testnetValueFor = {
    NETWORK_PASSPHRASE: TESTNET_NETWORK_PASSPHRASE,
    HORIZON_URL: TESTNET_HORIZON_URL,
    ASSET_ISSUER: TESTNET_USDC_ISSUER,
    EXPLORER_BASE_URL: TESTNET_EXPLORER_BASE_URL,
  } as const;
  for (const key of Object.keys(testnetValueFor) as Array<keyof typeof testnetValueFor>) {
    it(`refuses when ${key} equals the testnet value, naming it`, () => {
      const err = refusal({ ...OTHER, [key]: testnetValueFor[key] });
      expect(err.reasons).toEqual([`${key} equals the testnet value, which cannot belong to network type "othernet"`]);
    });
  }

  it('refuses without the acknowledgement, and with any value other than yes', () => {
    const { BRIDGE_ACKNOWLEDGE_REAL_FUNDS: _omit, ...rest } = OTHER;
    expect(refusal(rest).reasons).toEqual([`${REAL_FUNDS_ACK_ENV} must be "yes" to run on a network other than testnet`]);
    expect(refusal({ ...OTHER, BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'YES' }).reasons).toHaveLength(1);
    expect(refusal({ ...OTHER, BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'true' }).reasons).toHaveLength(1);
  });

  it('with only the type set, names all four values and the acknowledgement', () => {
    const err = refusal({ NETWORK_TYPE: 'othernet' });
    expect(err.reasons).toHaveLength(5);
    expect(err.message).toContain('network configuration refused');
  });
});

describe('verifyHorizonNetwork: the live half of the boot assertion (fix round of 18 October)', () => {
  const facts = networkFacts(OTHER);
  const refused = async (route: Parameters<typeof fakeFetch>[0]) => {
    const { fetchImpl } = fakeFetch(route);
    try { await verifyHorizonNetwork(facts, { fetch: fetchImpl }); } catch (e) { expect(e).toBeInstanceOf(NetworkConfigError); return (e as NetworkConfigError).reasons.join(' '); }
    throw new Error('expected a refusal');
  };

  it('asks the Horizon root for JSON and passes when network_passphrase equals NETWORK_PASSPHRASE', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { network_passphrase: OTHER.NETWORK_PASSPHRASE, horizon_version: 'x' } }));
    await expect(verifyHorizonNetwork(facts, { fetch: fetchImpl })).resolves.toBe(OTHER.NETWORK_PASSPHRASE);
    expect(calls[0]?.url).toBe('https://horizon.example.test/');
    expect(calls[0]?.headers.Accept).toBe('application/json');
    const { fetchImpl: f2, calls: c2 } = fakeFetch(() => ({ status: 200, body: { network_passphrase: OTHER.NETWORK_PASSPHRASE } }));
    await verifyHorizonNetwork({ ...facts, horizonUrl: 'https://horizon.example.test//' }, { fetch: f2 });
    expect(c2[0]?.url).toBe('https://horizon.example.test/');
  });

  it('refuses when Horizon serves another passphrase, naming both variables and quoting neither value', async () => {
    const msg = await refused(() => ({ status: 200, body: { network_passphrase: TESTNET_NETWORK_PASSPHRASE } }));
    expect(msg).toContain('HORIZON_URL serves a different network than NETWORK_PASSPHRASE names');
    expect(msg).not.toContain(TESTNET_NETWORK_PASSPHRASE);
    expect(msg).not.toContain(OTHER.NETWORK_PASSPHRASE);
  });

  it('the testnet constants pass against a root reporting the testnet passphrase; a testnet mirror under another name passes the string check and is caught here', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { network_passphrase: TESTNET_NETWORK_PASSPHRASE } }));
    await expect(verifyHorizonNetwork(TESTNET_FACTS, { fetch: fetchImpl })).resolves.toBe(TESTNET_NETWORK_PASSPHRASE);
    const mirrorEnv = { ...OTHER, HORIZON_URL: 'https://Horizon-Testnet.stellar.org/' };
    expect(() => assertNetwork(mirrorEnv)).not.toThrow();
    const { fetchImpl: f2 } = fakeFetch(() => ({ status: 200, body: { network_passphrase: TESTNET_NETWORK_PASSPHRASE } }));
    await expect(verifyHorizonNetwork(networkFacts(mirrorEnv), { fetch: f2 })).rejects.toBeInstanceOf(NetworkConfigError);
  });

  it('fails closed on a non-200, a missing field, a non-JSON body and a transport failure', async () => {
    expect(await refused(() => ({ status: 503 }))).toContain('answered HTTP 503');
    expect(await refused(() => ({ status: 200, body: { horizon_version: 'x' } }))).toContain('carries no network_passphrase field');
    const notJson = async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(verifyHorizonNetwork(facts, { fetch: notJson })).rejects.toThrow(/did not answer with a JSON document/);
    const boom = async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }); };
    await expect(verifyHorizonNetwork(facts, { fetch: boom })).rejects.toThrow(/did not answer \(TypeError\)/);
  });
});

describe('assertSameNetwork: .env and sdp/.env must name the same network (fix round of 18 October)', () => {
  it('passes when both name testnet (one explicitly, one by default) and when both name the same other network', () => {
    expect(assertSameNetwork({ label: '.env', env: {} }, { label: 'sdp/.env', env: { NETWORK_TYPE: 'testnet' } }).networkType).toBe('testnet');
    expect(assertSameNetwork({ label: '.env', env: OTHER }, { label: 'sdp/.env', env: { ...OTHER, EXPLORER_BASE_URL: 'https://another-explorer.example.test' } }).networkType).toBe('othernet');
  });

  it('refuses when the type, the passphrase, the Horizon or the issuer differ, naming the variable and both files, never a value', () => {
    const err = (() => { try { assertSameNetwork({ label: '.env', env: {} }, { label: 'sdp/.env', env: OTHER }); } catch (e) { return e as NetworkConfigError; } throw new Error('expected a refusal'); })();
    expect(err).toBeInstanceOf(NetworkConfigError);
    const text = err.reasons.join(' ');
    for (const v of ['NETWORK_TYPE', 'NETWORK_PASSPHRASE', 'HORIZON_URL', 'ASSET_ISSUER']) expect(text).toContain(`${v} differs between .env and sdp/.env`);
    expect(text).not.toContain('EXPLORER_BASE_URL');
    expect(text).not.toContain(OTHER.NETWORK_PASSPHRASE);
    const one = (() => { try { assertSameNetwork({ label: '.env', env: OTHER }, { label: 'sdp/.env', env: { ...OTHER, HORIZON_URL: 'https://horizon-b.example.test' } }); } catch (e) { return e as NetworkConfigError; } return undefined; })();
    expect(one?.reasons).toEqual(['HORIZON_URL differs between .env and sdp/.env']);
  });
});
