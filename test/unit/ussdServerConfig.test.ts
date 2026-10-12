import { describe, expect, it } from 'vitest';
import { ussdConfigFromEnv } from '../../src/ussd/server.js';

describe('ussdConfigFromEnv', () => {
  it('creation on dial is off unless the environment says exactly true', () => {
    expect(ussdConfigFromEnv({}).createOnDial).toBe(false);
    expect(ussdConfigFromEnv({ USSD_CREATE_ON_DIAL: 'false' }).createOnDial).toBe(false);
    expect(ussdConfigFromEnv({ USSD_CREATE_ON_DIAL: 'yes' }).createOnDial).toBe(false);
    expect(ussdConfigFromEnv({ USSD_CREATE_ON_DIAL: '1' }).createOnDial).toBe(false);
    expect(ussdConfigFromEnv({ USSD_CREATE_ON_DIAL: 'true' }).createOnDial).toBe(true);
    expect(ussdConfigFromEnv({ USSD_CREATE_ON_DIAL: ' TRUE ' }).createOnDial).toBe(true);
  });

  it('reads the creation caps with their defaults and refuses a bad value', () => {
    expect(ussdConfigFromEnv({}).creationCaps).toEqual({ minSponsorXlm: 10, maxPerHour: 5 });
    expect(ussdConfigFromEnv({ USSD_CREATE_MIN_SPONSOR_XLM: '2.5', USSD_CREATE_MAX_PER_HOUR: '20' }).creationCaps).toEqual({ minSponsorXlm: 2.5, maxPerHour: 20 });
    expect(() => ussdConfigFromEnv({ USSD_CREATE_MAX_PER_HOUR: 'many' })).toThrow(/USSD_CREATE_MAX_PER_HOUR/);
  });
});
