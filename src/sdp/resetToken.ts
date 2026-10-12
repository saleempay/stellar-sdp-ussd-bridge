/**
 * Reading the owner's password reset token out of the SDP API log.
 *
 * With EMAIL_SENDER_TYPE=DRY_RUN the SDP prints every message it would
 * send to its standard output (internal/message/dry_run_client.go:17-21 at
 * 7.0.0): a line "Recipient: <email>", then the message body, which for a
 * forgotten password carries the link
 * "<tenant sdp_ui_base_url>/reset-password?token=<token>". The SDP does
 * not re-send while an earlier token is still valid
 * (forgot_password_handler.go:124-125), so the newest block for the
 * recipient is the one that applies.
 *
 * Matching rules, each closing a way of picking up the wrong token:
 * - the recipient line is matched as the email followed by a line end,
 *   so "owner@bridge.local" never matches "owner@bridge.local.test";
 * - when the tenant's UI base URL is known, the link must start with it,
 *   so two tenants configured with the same owner email cannot pick up
 *   each other's token (the env allows the same email on both).
 *
 * The token is returned to the caller for one reset call and is never
 * printed or stored by this module.
 */

export interface ResetTokenMatch {
  /** The recipient, matched exactly against the "Recipient:" line. */
  email: string;
  /** The tenant's sdp_ui_base_url; when given, the reset link must start with it. */
  uiBaseUrl?: string;
}

const TOKEN_CHARS = '[A-Za-z0-9._~-]+';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The newest reset token for the recipient (and tenant) in a log text, if any. */
export function findResetToken(log: string, match: ResetTokenMatch): string | undefined {
  const blocks = log
    .split('Recipient: ')
    .slice(1)
    .filter((b) => b.startsWith(`${match.email}\n`) || b.startsWith(`${match.email}\r\n`));
  const base = match.uiBaseUrl ? `${escapeRegExp(match.uiBaseUrl.replace(/\/+$/, ''))}/` : '';
  const re = new RegExp(`${base}reset-password\\?token=(${TOKEN_CHARS})`);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const m = re.exec(blocks[i]!);
    if (m) return m[1];
  }
  return undefined;
}

/** Default window the scanner keeps before it folds the buffer down. */
export const SCANNER_WINDOW_BYTES = 4 * 1024 * 1024;
/**
 * Tail kept after a fold: a dry run message is a few kilobytes, so a block
 * cut at the fold point would need to be larger than this to be missed.
 */
export const SCANNER_TAIL_BYTES = 64 * 1024;

/**
 * Streaming reader for a log of any length: feed it chunks as they arrive
 * and ask for the result at the end. It never holds more than the window
 * plus one chunk, so a long-running stack's log cannot overflow a buffer
 * or be truncated the way a single bounded read can.
 */
export class ResetTokenScanner {
  private buffer = '';
  private last: string | undefined;
  constructor(
    private readonly match: ResetTokenMatch,
    private readonly windowBytes = SCANNER_WINDOW_BYTES,
    private readonly tailBytes = SCANNER_TAIL_BYTES,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > this.windowBytes) {
      const found = findResetToken(this.buffer, this.match);
      if (found) this.last = found;
      this.buffer = this.buffer.slice(-this.tailBytes);
    }
  }

  /** The newest token seen so far, or undefined. */
  result(): string | undefined {
    return findResetToken(this.buffer, this.match) ?? this.last;
  }
}
