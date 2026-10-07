/**
 * Helpers for the sandbox capture: the startup banner with the callback
 * path masked (adapter issue #8), MSISDN and PIN masking for transcripts,
 * and a recording wrapper around the HTTP listener.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** `/****` plus the last four characters; a short path masks fully. */
export function maskCallbackPath(path: string): string {
  if (path.length < 12) return '/****';
  return `/****${path.slice(-4)}`;
}

/** +254700000000 to +2547***0000 */
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

export interface Exchange {
  at: string;
  fields: Record<string, string>;
  status: number;
  response: string;
  serverMs: number;
}

/** Wrap a listener so every callback and its response are recorded, masked. */
export function recordingListener(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  onExchange: (e: Exchange) => void,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const started = Date.now();
    let rawBody = '';
    req.on('data', (chunk: Buffer) => {
      rawBody += chunk.toString('utf8');
    });
    req.on('end', () => {
      const originalEnd = res.end.bind(res);
      (res as unknown as { end: (body?: unknown) => unknown }).end = (body?: unknown) => {
        onExchange({
          at: new Date(started).toISOString(),
          fields: maskCallbackFields(rawBody),
          status: res.statusCode,
          response: maskPinTokens(typeof body === 'string' ? body : ''),
          serverMs: Date.now() - started,
        });
        return originalEnd(body as string);
      };
      const replay = Object.assign(req, {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(rawBody, 'utf8');
        },
      });
      listener(replay, res);
    });
  };
}
