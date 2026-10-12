/**
 * The closing line of screens 7 (account) and 8 (About), a configuration
 * value. Its default is the contracted text of the walkthrough attached to
 * the Africa's Talking service order (docs/ussd-menu-walkthrough-v1.md,
 * section 4). Any other value is a menu change that needs written notice
 * to Africa's Talking before production (walkthrough section 7).
 *
 * At boot the value is refused when it would break the character budget
 * of either screen or when it carries a character outside printable
 * ASCII: the gateway's character limit is per telco (Safaricom KE 160,
 * Africa's Talking help centre article 1284096, read 10 October 2026),
 * and the provider's USSD documentation advises plain text without
 * special characters, which telcos cannot render (as recorded from
 * developers.africastalking.com/docs/ussd/overview on 23 August 2026 in
 * the adapter, src/ussd/menu/screens.ts:14-15; the page refused automated
 * reads on 10 October 2026).
 */

/** The contracted text, screens 7 and 8 of the walkthrough. */
export const DEFAULT_CLOSING_LINE = 'Test only, no funds move';

export const CLOSING_LINE_ENV = 'USSD_CLOSING_LINE';

export class ClosingLineError extends Error {
  constructor(message: string) {
    super(`${CLOSING_LINE_ENV} refused: ${message}`);
    this.name = 'ClosingLineError';
  }
}

/**
 * Validate a closing line. `maxLength` is the longest line the tighter
 * of the two screens can carry within the budget; screens.ts computes it
 * from the account screen at its longest dynamic values.
 */
export function validateClosingLine(line: string, maxLength: number): string {
  if (line.length === 0) throw new ClosingLineError('the line is empty');
  if (!/^[\x20-\x7e]+$/.test(line)) throw new ClosingLineError('only printable ASCII characters are allowed (no line breaks, accents, symbols or emoji; telcos cannot render them)');
  if (line !== line.trim()) throw new ClosingLineError('leading or trailing spaces are not allowed');
  if (line.length > maxLength) throw new ClosingLineError(`${line.length} characters; at most ${maxLength} fit the 160 character screen budget at the account screen's longest values`);
  return line;
}

/** The closing line from the environment: the default when unset or blank, else validated. */
export function closingLineFromEnv(env: Record<string, string | undefined>, maxLength: number): string {
  const raw = env[CLOSING_LINE_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CLOSING_LINE;
  return validateClosingLine(raw, maxLength);
}
