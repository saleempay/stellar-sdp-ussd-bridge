/**
 * "Ready to dial" is earned, not assumed. Before the operator saves the
 * callback and dials, the hostname must resolve on two public resolvers
 * and a well-formed gateway POST through the public URL must come back as
 * screen 1. Anything less is printed as NOT READY with the reasons.
 *
 * The probe uses a placeholder number and no inputs, so it reaches only the
 * main menu: no PIN, no account read, no account creation. Its record in
 * the capture carries a `readiness-` session id.
 */

export const DEFAULT_RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const;

/** Placeholder MSISDN for the probe; the welcome step never acts on it. */
export const PROBE_MSISDN = '+254700000000';

export const SCREEN_ONE_PREFIX = 'CON Saleem';

export interface DnsCheck {
  server: string;
  addresses: string[];
  error?: string;
}

export interface ProbeResult {
  status: number | null;
  bodyPrefix: string;
  error?: string;
  ok: boolean;
}

export interface DialReadiness {
  at: string;
  hostname: string;
  dns: DnsCheck[];
  probe: ProbeResult;
  ready: boolean;
  reasons: string[];
}

/** Resolve a hostname against one named server; injected for tests. */
export type ResolveFn = (server: string, hostname: string) => Promise<string[]>;

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export async function defaultResolve(server: string, hostname: string): Promise<string[]> {
  const { Resolver } = await import('node:dns/promises');
  const r = new Resolver({ timeout: 4_000, tries: 2 });
  r.setServers([server]);
  try {
    return await r.resolve4(hostname);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND') return r.resolve6(hostname);
    throw err;
  }
}

export async function checkDns(hostname: string, resolvers: readonly string[] = DEFAULT_RESOLVERS, resolve: ResolveFn = defaultResolve): Promise<DnsCheck[]> {
  return Promise.all(
    resolvers.map(async (server) => {
      try {
        const addresses = await resolve(server, hostname);
        return addresses.length > 0 ? { server, addresses } : { server, addresses, error: 'no addresses' };
      } catch (err) {
        return { server, addresses: [], error: (err as { code?: string; message?: string }).code ?? (err as Error).message ?? 'error' };
      }
    }),
  );
}

/** The form body of a well-formed initial-dial callback, as the gateway sends it. */
export function probeBody(sessionId: string): string {
  const p = new URLSearchParams();
  p.set('sessionId', sessionId);
  p.set('phoneNumber', PROBE_MSISDN);
  p.set('networkCode', '99999');
  p.set('serviceCode', '*384*45210#');
  p.set('text', '');
  return p.toString();
}

export async function probeScreenOne(baseUrl: string, callbackPath: string, fetchImpl: FetchFn = (u, i) => fetch(u, i), now: () => number = Date.now): Promise<ProbeResult> {
  const sessionId = `readiness-${now()}`;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${callbackPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'stellar-sdp-ussd-bridge readiness probe' },
      body: probeBody(sessionId),
    });
    const text = await res.text();
    const bodyPrefix = text.slice(0, 40);
    return { status: res.status, bodyPrefix, ok: res.status === 200 && text.startsWith(SCREEN_ONE_PREFIX) };
  } catch (err) {
    return { status: null, bodyPrefix: '', error: (err as Error).message, ok: false };
  }
}

export interface DialReadinessDeps {
  resolvers?: readonly string[];
  resolve?: ResolveFn;
  fetchImpl?: FetchFn;
  now?: () => number;
}

/** Both resolvers answer and the probe returns screen 1: ready. */
export async function assessDialReadiness(hostname: string, callbackPath: string, deps: DialReadinessDeps = {}): Promise<DialReadiness> {
  const now = deps.now ?? Date.now;
  const dns = await checkDns(hostname, deps.resolvers ?? DEFAULT_RESOLVERS, deps.resolve ?? defaultResolve);
  const reasons: string[] = [];
  for (const d of dns) if (d.error || d.addresses.length === 0) reasons.push(`hostname does not resolve on ${d.server}: ${d.error ?? 'no addresses'}`);
  let probe: ProbeResult;
  if (reasons.length === 0) {
    probe = await probeScreenOne(`https://${hostname}`, callbackPath, deps.fetchImpl, now);
    if (!probe.ok) {
      reasons.push(
        probe.error
          ? `probe POST failed: ${probe.error}`
          : `probe POST returned ${probe.status} with body starting ${JSON.stringify(probe.bodyPrefix.slice(0, 20))}, expected 200 and ${JSON.stringify(SCREEN_ONE_PREFIX)}`,
      );
    }
  } else {
    probe = { status: null, bodyPrefix: '', error: 'skipped: hostname did not resolve', ok: false };
  }
  return { at: new Date(now()).toISOString(), hostname, dns, probe, ready: reasons.length === 0, reasons };
}

/** The readiness lines for the console; hostname in full, path never. */
export function readinessReport(r: DialReadiness): string {
  const lines = [
    `Readiness check at ${r.at} for ${r.hostname}:`,
    ...r.dns.map((d) => `  DNS ${d.server}: ${d.error ? `FAIL (${d.error})` : `ok (${d.addresses.join(', ')})`}`),
    `  probe POST: ${r.probe.ok ? `ok (200, ${JSON.stringify(SCREEN_ONE_PREFIX)})` : `FAIL (${r.probe.error ?? `${r.probe.status}, body ${JSON.stringify(r.probe.bodyPrefix.slice(0, 20))}`})`}`,
  ];
  if (r.ready) lines.push(`READY TO DIAL: https://${r.hostname} resolves on ${r.dns.length} public resolvers and answers screen 1 on the callback path.`);
  else lines.push('NOT READY TO DIAL:', ...r.reasons.map((x) => `  - ${x}`));
  return lines.join('\n');
}
