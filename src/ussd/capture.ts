/**
 * Helpers for the sandbox capture: the startup banner with the callback
 * path masked (adapter issue #8), MSISDN and PIN masking for transcripts,
 * and a recording wrapper around the HTTP listener.
 *
 * The recorder keeps, for every request whatever its status (404 included),
 * the facts needed to tell a gateway callback from a browser hit or a
 * tunnel probe: method, the path as segment lengths (never the path text),
 * whether the path equals the configured callback path, whether a query
 * string was present, content type and length, user agent, and the
 * forwarding headers a tunnel adds (x-forwarded-for, cf-connecting-ip,
 * x-forwarded-proto, cf-ipcountry). The path itself is a capability URL
 * and is never written anywhere by this module.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** `/****` plus the last four characters; a short path masks fully. */
export function maskCallbackPath(path: string): string {
  if (path.length < 12) return '/****';
  return `/****${path.slice(-4)}`;
}

/** +999700000000 to +9997***0000; the +999 country code is not assignable, so no number in it can belong to a subscriber */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/[^\d+]/g, '');
  if (digits.length <= 9) return digits;
  return `${digits.slice(0, 5)}***${digits.slice(-4)}`;
}

/** Every four-digit token in a gateway text field becomes ####; menu inputs are single digits. */
export function maskPinTokens(text: string): string {
  return text
    .split('*')
    .map((t) => (/^\d{4}$/.test(t) ? '####' : t))
    .join('*');
}

/** Mask the fields of an Africa's Talking callback body. */
export function maskCallbackFields(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) {
    if (k === 'phoneNumber') out[k] = maskMsisdn(v);
    else if (k === 'text') out[k] = maskPinTokens(v);
    else out[k] = v;
  }
  return out;
}

/**
 * A request path as the lengths of its segments, so a path can be compared
 * and described without writing it: `/ussd/abc` is `[4, 3]`, a trailing
 * slash shows as a final 0 (`/ussd/abc/` is `[4, 3, 0]`), and `/` is `[0]`.
 * The query string is not part of the path.
 */
export function pathSegmentLengths(path: string): number[] {
  const bare = path.split('?')[0] ?? '';
  const stripped = bare.startsWith('/') ? bare.slice(1) : bare;
  return stripped.split('/').map((s) => s.length);
}

export function captureBanner(port: number, callbackPath: string, tunnelBaseUrl?: string): string {
  return [
    '',
    "=== Africa's Talking sandbox capture: operator steps ===",
    `Server listening on port ${port}. Callback path from .env, USSD_CALLBACK_PATH, shown masked: ${maskCallbackPath(callbackPath)}`,
    tunnelBaseUrl ? `Tunnel base URL: ${tunnelBaseUrl}` : 'Tunnel base URL: not given (pass --tunnel-url); expose the port through your tunnel.',
    'Set the sandbox USSD callback to the tunnel base URL followed by the USSD_CALLBACK_PATH value from .env.',
    'Dial the sandbox service code from the simulator with the agreed number.',
    '',
  ].join('\n');
}

/** Facts about one request, recorded for every status. Holds no path text and no body. */
export interface RequestFacts {
  method: string;
  /** See {@link pathSegmentLengths}. */
  pathSegmentLengths: number[];
  /** Path (without query) equals the configured callback path; null when none was given to the recorder. */
  pathMatches: boolean | null;
  hasQuery: boolean;
  contentType: string | null;
  /** The content-length header as sent; null when absent. */
  contentLength: number | null;
  /** Bytes actually read from the request body. */
  bodyBytes: number;
  userAgent: string | null;
  /** x-forwarded-for */
  forwardedFor: string | null;
  /** cf-connecting-ip (cloudflared) */
  connectingIp: string | null;
  /** x-forwarded-proto */
  forwardedProto: string | null;
  /** cf-ipcountry (cloudflared) */
  country: string | null;
  /** The socket peer, the tunnel connector itself when a tunnel is in front. */
  remoteAddress: string | null;
}

export interface Exchange {
  at: string;
  request: RequestFacts;
  fields: Record<string, string>;
  status: number;
  response: string;
  serverMs: number;
}

export interface RecordingOptions {
  /** The configured callback path, used only for the pathMatches comparison; never recorded. */
  callbackPath?: string;
}

function headerString(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(', ') : v;
}

export function requestFacts(req: IncomingMessage, bodyBytes: number, callbackPath?: string): RequestFacts {
  const url = req.url ?? '';
  const path = url.split('?')[0] ?? '';
  const lengthHeader = headerString(req, 'content-length');
  const contentLength = lengthHeader === null || lengthHeader === '' || Number.isNaN(Number(lengthHeader)) ? null : Number(lengthHeader);
  return {
    method: req.method ?? '',
    pathSegmentLengths: pathSegmentLengths(path),
    pathMatches: callbackPath === undefined ? null : path === callbackPath,
    hasQuery: url.includes('?'),
    contentType: headerString(req, 'content-type'),
    contentLength,
    bodyBytes,
    userAgent: headerString(req, 'user-agent'),
    forwardedFor: headerString(req, 'x-forwarded-for'),
    connectingIp: headerString(req, 'cf-connecting-ip'),
    forwardedProto: headerString(req, 'x-forwarded-proto'),
    country: headerString(req, 'cf-ipcountry'),
    remoteAddress: req.socket?.remoteAddress ?? null,
  };
}

/** One line per exchange for the console: the request facts, no path text. */
export function describeExchange(e: Exchange): string {
  const r = e.request;
  return [
    e.at,
    `${e.serverMs} ms`,
    r.method,
    `path=[${r.pathSegmentLengths.join(',')}]`,
    `match=${r.pathMatches === null ? 'n/a' : r.pathMatches ? 'yes' : 'no'}`,
    `query=${r.hasQuery ? 'yes' : 'no'}`,
    `type=${r.contentType ?? '-'}`,
    `len=${r.contentLength ?? '-'}/${r.bodyBytes}`,
    `ua=${JSON.stringify(r.userAgent ?? '')}`,
    `xff=${r.forwardedFor ?? '-'}`,
    `cfip=${r.connectingIp ?? '-'}`,
    `proto=${r.forwardedProto ?? '-'}`,
    `country=${r.country ?? '-'}`,
    `-> ${e.status} ${JSON.stringify(e.response).slice(0, 60)}`,
  ].join('  ');
}

/** Wrap a listener so every request and its response are recorded, masked. */
export function recordingListener(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  onExchange: (e: Exchange) => void,
  options: RecordingOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const rawBody = raw.toString('utf8');
      const request = requestFacts(req, raw.length, options.callbackPath);
      const originalEnd = res.end.bind(res);
      (res as unknown as { end: (body?: unknown) => unknown }).end = (body?: unknown) => {
        onExchange({
          at: new Date(started).toISOString(),
          request,
          fields: maskCallbackFields(rawBody),
          status: res.statusCode,
          response: maskPinTokens(typeof body === 'string' ? body : ''),
          serverMs: Date.now() - started,
        });
        return originalEnd(body as string);
      };
      const replay = Object.assign(req, {
        [Symbol.asyncIterator]: async function* () {
          yield raw;
        },
      });
      listener(replay, res);
    });
  };
}
