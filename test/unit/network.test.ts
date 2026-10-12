import { describe, expect, it } from 'vitest';
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
