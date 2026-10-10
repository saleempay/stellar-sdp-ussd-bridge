import { describe, expect, it } from 'vitest';
import { NetworkConfigError, TESTNET_FACTS } from '../../src/sdp/network.js';
import { ClosingLineError, DEFAULT_CLOSING_LINE } from '../../src/ussd/closingLine.js';
import { createUssdServer, ussdConfigFromEnv } from '../../src/ussd/server.js';

const minimal = { USSD_CALLBACK_PATH: '/ussd/test-only-path', USSD_CREATE_ON_DIAL: 'false' };

describe('ussdConfigFromEnv: the boot assertion and the closing line', () => {
  it('on testnet with nothing else set, the network is the testnet facts and the closing line the contracted text', () => {
    const cfg = ussdConfigFromEnv(minimal);
    expect(cfg.network).toEqual(TESTNET_FACTS);
    expect(cfg.closingLine).toBe(DEFAULT_CLOSING_LINE);
    expect(cfg.assetCode).toBe('USDC');
  });

  it('refuses a mixed network, naming the variable', () => {
    expect(() => ussdConfigFromEnv({ ...minimal, HORIZON_URL: 'https://horizon.example.test' })).toThrow(NetworkConfigError);
    expect(() => ussdConfigFromEnv({ ...minimal, HORIZON_URL: 'https://horizon.example.test' })).toThrow(/HORIZON_URL does not equal the testnet value/);
  });

  it('refuses another network without the acknowledgement', () => {
    expect(() => ussdConfigFromEnv({ ...minimal, NETWORK_TYPE: 'othernet' })).toThrow(/BRIDGE_ACKNOWLEDGE_REAL_FUNDS/);
  });

  it('accepts another network with every value supplied and the acknowledgement, without a testnet-only refusal anywhere', () => {
    const cfg = ussdConfigFromEnv({
      ...minimal,
      NETWORK_TYPE: 'othernet',
      NETWORK_PASSPHRASE: 'Other Network ; Example Only',
      HORIZON_URL: 'https://horizon.example.test',
      ASSET_ISSUER: 'G'.padEnd(56, 'A'),
      EXPLORER_BASE_URL: 'https://explorer.example.test/other',
      BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes',
    });
    expect(cfg.network?.networkType).toBe('othernet');
    const server = createUssdServer(cfg);
    expect(typeof server.listener).toBe('function');
  });

  it('refuses a closing line that breaks the budget or is not printable ASCII', () => {
    expect(() => ussdConfigFromEnv({ ...minimal, USSD_CLOSING_LINE: 'x'.repeat(200) })).toThrow(ClosingLineError);
    expect(() => ussdConfigFromEnv({ ...minimal, USSD_CLOSING_LINE: 'Café' })).toThrow(ClosingLineError);
  });

  it('threads a valid closing line into the machine', () => {
    const cfg = ussdConfigFromEnv({ ...minimal, USSD_CLOSING_LINE: 'Demonstration service' });
    expect(createUssdServer(cfg).machine.closingLine).toBe('Demonstration service');
    expect(createUssdServer(ussdConfigFromEnv(minimal)).machine.closingLine).toBe(DEFAULT_CLOSING_LINE);
  });

  it('creation on dial still needs the sponsor secret', () => {
    expect(() => createUssdServer(ussdConfigFromEnv({ USSD_CALLBACK_PATH: '/x', USSD_CREATE_ON_DIAL: 'true' }))).toThrow(/SPONSOR_SECRET_KEY/);
  });
});
