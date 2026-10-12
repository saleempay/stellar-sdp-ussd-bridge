/**
 * The public tunnel in front of the USSD callback server, as the capture
 * script manages it.
 *
 * Why this exists: a cloudflared quick tunnel gets a new hostname on every
 * start ("The hostname changes each time you create a Quick Tunnel",
 * developers.cloudflare.com, TryCloudflare page, read 11 October 2026). On
 * 7 and 10 October 2026 the gateway dashboard kept a hostname from an
 * earlier start while the server listened behind a newer one, and every
 * dial failed with UnknownHostException, 502 or 530 at the gateway. The
 * hostname is therefore printed in full on every start and restart, with
 * a reminder that the dashboard callback must be updated, and every start
 * is written to the capture record.
 *
 * The hostname is not a secret. The callback path is, and nothing in this
 * module prints it.
 */

export type TunnelMode = 'quick' | 'named' | 'external';

export interface TunnelConfig {
  mode: TunnelMode;
  /** The fixed public hostname (named mode), or the hostname of an external tunnel. */
  hostname?: string;
  /** Named mode, remotely managed: the tunnel token from the Cloudflare dashboard. */
  token?: string;
  /** Named mode, locally managed: the tunnel name created with `cloudflared tunnel create`. */
  name?: string;
}

/** A tunnel start as written to the capture record. */
export interface TunnelStart {
  at: string;
  hostname: string;
  mode: TunnelMode;
  /** True when this start replaced an earlier tunnel of the same session. */
  restart: boolean;
}

/**
 * Read the tunnel configuration from the environment.
 *
 * `USSD_TUNNEL_MODE`: `quick` (default; a cloudflared quick tunnel, new
 * hostname per start), `named` (a cloudflared named tunnel on a fixed
 * hostname: `USSD_TUNNEL_HOSTNAME` plus either `USSD_TUNNEL_TOKEN` or
 * `USSD_TUNNEL_NAME`), or `external` (a tunnel you run yourself; pass its
 * base URL with `--tunnel-url`).
 */
export function tunnelConfigFromEnv(env: Record<string, string | undefined>): TunnelConfig {
  const mode = (env.USSD_TUNNEL_MODE ?? 'quick').toLowerCase();
  if (mode !== 'quick' && mode !== 'named' && mode !== 'external') {
    throw new Error(`USSD_TUNNEL_MODE must be quick, named or external (got "${mode}")`);
  }
  const cfg: TunnelConfig = { mode };
  if (env.USSD_TUNNEL_HOSTNAME) cfg.hostname = normaliseHostname(env.USSD_TUNNEL_HOSTNAME);
  if (env.USSD_TUNNEL_TOKEN) cfg.token = env.USSD_TUNNEL_TOKEN;
  if (env.USSD_TUNNEL_NAME) cfg.name = env.USSD_TUNNEL_NAME;
  if (mode === 'named') {
    if (!cfg.hostname) throw new Error('USSD_TUNNEL_MODE=named needs USSD_TUNNEL_HOSTNAME (the fixed public hostname)');
    if (!cfg.token && !cfg.name) throw new Error('USSD_TUNNEL_MODE=named needs USSD_TUNNEL_TOKEN or USSD_TUNNEL_NAME');
  }
  return cfg;
}

/** `https://host/`, `host:443` or `host` to `host`. */
export function normaliseHostname(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/[/:].*$/, '').toLowerCase();
}

/**
 * The cloudflared command for a managed mode. External mode runs nothing.
 * Quick: `cloudflared tunnel --no-autoupdate --url http://localhost:<port>`
 * (TryCloudflare page). Named with a token: `cloudflared tunnel run --token`
 * (the public hostname is routed in the Cloudflare dashboard). Named with
 * a name: `cloudflared tunnel run --url http://localhost:<port> <name>`
 * (`--url` on `run` verified with `cloudflared tunnel run --help`,
 * version 2026.8.2).
 */
export function tunnelCommand(cfg: TunnelConfig, port: number): { command: string; args: string[] } | undefined {
  const origin = `http://localhost:${port}`;
  if (cfg.mode === 'quick') return { command: 'cloudflared', args: ['tunnel', '--no-autoupdate', '--url', origin] };
  if (cfg.mode === 'named') {
    if (cfg.token) return { command: 'cloudflared', args: ['tunnel', '--no-autoupdate', 'run', '--token', cfg.token] };
    return { command: 'cloudflared', args: ['tunnel', '--no-autoupdate', 'run', '--url', origin, cfg.name!] };
  }
  return undefined;
}

/** The quick tunnel hostname from a cloudflared log line, if the line carries one. */
export function parseQuickTunnelHostname(line: string): string | undefined {
  const m = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i.exec(line);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** The lines printed on every tunnel start; the hostname in full, never the path. */
export function tunnelStartNotice(start: TunnelStart, previousHostname?: string): string {
  const lines = [
    '',
    start.restart
      ? `=== TUNNEL RESTARTED at ${start.at}: hostname changed from ${previousHostname ?? 'unknown'} to ${start.hostname} ===`
      : `=== Tunnel up at ${start.at} (${start.mode}): hostname ${start.hostname} ===`,
    `Public base URL: https://${start.hostname}`,
    start.restart
      ? 'The dashboard callback must be UPDATED to the new hostname before the next dial. The old hostname no longer resolves.'
      : 'The dashboard callback must be set to this hostname followed by USSD_CALLBACK_PATH from .env (https, no trailing slash).',
    'After saving, reopen the channel and confirm the saved host matches the hostname above.',
    '',
  ];
  return lines.join('\n');
}
