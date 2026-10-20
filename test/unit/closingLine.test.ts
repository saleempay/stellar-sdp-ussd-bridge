import { describe, expect, it } from 'vitest';
import { CLOSING_LINE_ENV, ClosingLineError, DEFAULT_CLOSING_LINE, closingLineFromEnv, validateClosingLine } from '../../src/ussd/closingLine.js';
import { SCREENS, TEXT_BUDGET, accountScreenAtMaxLength, allScreensAtMaxLength, maxClosingLineLength } from '../../src/ussd/screens.js';

const MAX = maxClosingLineLength();
const refusal = (env: Record<string, string | undefined>): ClosingLineError => {
  try {
    closingLineFromEnv(env, MAX);
  } catch (e) {
    expect(e).toBeInstanceOf(ClosingLineError);
    return e as ClosingLineError;
  }
  throw new Error('expected a refusal');
};

describe('closing line default', () => {
  it('is the contracted text', () => {
    expect(DEFAULT_CLOSING_LINE).toBe('Test only, no funds move');
  });

  it('applies when the variable is unset or blank', () => {
    expect(closingLineFromEnv({}, MAX)).toBe(DEFAULT_CLOSING_LINE);
    expect(closingLineFromEnv({ [CLOSING_LINE_ENV]: '' }, MAX)).toBe(DEFAULT_CLOSING_LINE);
    expect(closingLineFromEnv({ [CLOSING_LINE_ENV]: '   ' }, MAX)).toBe(DEFAULT_CLOSING_LINE);
  });

  it('is what screens 7 and 8 render when no line is given', () => {
    expect(SCREENS.about().text.endsWith(`\n${DEFAULT_CLOSING_LINE}`)).toBe(true);
    expect(accountScreenAtMaxLength().text.endsWith(`\n${DEFAULT_CLOSING_LINE}`)).toBe(true);
  });
});

describe('closing line configured', () => {
  it('renders on screens 7 and 8 and nowhere else', () => {
    const line = 'Demonstration service';
    expect(closingLineFromEnv({ [CLOSING_LINE_ENV]: line }, MAX)).toBe(line);
    const screens = allScreensAtMaxLength(line);
    const carrying = screens.filter((s) => s.text.includes(line));
    expect(carrying.map((s) => s.hop)).toEqual(['account', 'account', 'about']);
    expect(screens.some((s) => s.text.includes(DEFAULT_CLOSING_LINE))).toBe(false);
  });

  it('the longest allowed line keeps every screen within the budget; one more character does not', () => {
    const longest = 'x'.repeat(MAX);
    expect(validateClosingLine(longest, MAX)).toBe(longest);
    for (const s of allScreensAtMaxLength(longest)) expect(s.text.length).toBeLessThanOrEqual(TEXT_BUDGET);
    expect(accountScreenAtMaxLength(longest).text.length).toBe(TEXT_BUDGET);
    const tooLong = 'x'.repeat(MAX + 1);
    expect(accountScreenAtMaxLength(tooLong).text.length).toBe(TEXT_BUDGET + 1);
    expect(refusal({ [CLOSING_LINE_ENV]: tooLong }).message).toContain(`at most ${MAX}`);
  });

  it('the maximum is derived from the account screen at its longest values', () => {
    expect(MAX).toBe(TEXT_BUDGET - accountScreenAtMaxLength('').text.length);
    expect(MAX).toBeGreaterThanOrEqual(DEFAULT_CLOSING_LINE.length);
  });
});

describe('closing line refusals', () => {
  it('refuses a line break', () => {
    expect(refusal({ [CLOSING_LINE_ENV]: 'Two\nlines' }).message).toContain('printable ASCII');
  });

  it('refuses characters outside printable ASCII (accents, symbols, emoji, tabs)', () => {
    for (const bad of ['Café only', 'No funds → move', 'Test 🙂', 'tab\there']) {
      expect(refusal({ [CLOSING_LINE_ENV]: bad }).message).toContain('printable ASCII');
    }
  });

  it('refuses leading or trailing spaces, which the screen would show', () => {
    expect(refusal({ [CLOSING_LINE_ENV]: ' Demonstration service' }).message).toContain('leading or trailing spaces');
    expect(refusal({ [CLOSING_LINE_ENV]: 'Demonstration service ' }).message).toContain('leading or trailing spaces');
  });

  it('names the variable in every refusal', () => {
    expect(refusal({ [CLOSING_LINE_ENV]: 'x'.repeat(MAX + 1) }).message.startsWith(`${CLOSING_LINE_ENV} refused:`)).toBe(true);
  });
});
