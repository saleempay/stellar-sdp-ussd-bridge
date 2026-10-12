import { describe, expect, it } from 'vitest';
import { ResetTokenScanner, findResetToken } from '../../src/sdp/resetToken.js';

const UI = 'http://bridge.localhost:3000';
const block = (email: string, token: string, ui = UI) =>
  `Recipient: ${email}\nSubject: Reset password\nBody: <a href="${ui}/reset-password?token=${token}">Reset</a>\n\n`;

describe('findResetToken', () => {
  it('returns the newest token for the exact recipient', () => {
    const log = `startup\n${block('owner@bridge.local', 'tok-old')}other line\n${block('owner@bridge.local', 'tok-new')}`;
    expect(findResetToken(log, { email: 'owner@bridge.local' })).toBe('tok-new');
  });

  it('matches the email followed by a line end, never a longer email with the same prefix', () => {
    const log = block('owner@bridge.local.test', 'tok-prefix');
    expect(findResetToken(log, { email: 'owner@bridge.local' })).toBeUndefined();
    expect(findResetToken(log, { email: 'owner@bridge.local.test' })).toBe('tok-prefix');
    expect(findResetToken(block('owner@bridge.local', 'tok-crlf').replace(/\n/g, '\r\n'), { email: 'owner@bridge.local' })).toBe('tok-crlf');
  });

  it('with the tenant UI base URL, only that tenant\'s link counts, even for the same owner email', () => {
    const log = `${block('owner@x.local', 'tok-scope', 'http://scopetest.localhost:3000')}${block('owner@x.local', 'tok-bridge', UI)}${block('owner@x.local', 'tok-scope-2', 'http://scopetest.localhost:3000')}`;
    expect(findResetToken(log, { email: 'owner@x.local', uiBaseUrl: UI })).toBe('tok-bridge');
    expect(findResetToken(log, { email: 'owner@x.local', uiBaseUrl: 'http://scopetest.localhost:3000' })).toBe('tok-scope-2');
    expect(findResetToken(log, { email: 'owner@x.local', uiBaseUrl: `${UI}/` })).toBe('tok-bridge');
    expect(findResetToken(log, { email: 'owner@x.local', uiBaseUrl: 'http://nowhere.localhost:3000' })).toBeUndefined();
  });

  it('returns undefined when the recipient has no message', () => {
    expect(findResetToken('nothing here\n', { email: 'owner@bridge.local' })).toBeUndefined();
    expect(findResetToken(block('someone@else.local', 'tok'), { email: 'owner@bridge.local' })).toBeUndefined();
  });
});

describe('ResetTokenScanner', () => {
  it('finds a block split across chunks', () => {
    const log = `${block('owner@bridge.local', 'tok-split')}`;
    const s = new ResetTokenScanner({ email: 'owner@bridge.local', uiBaseUrl: UI });
    for (let i = 0; i < log.length; i += 7) s.push(log.slice(i, i + 7));
    expect(s.result()).toBe('tok-split');
  });

  it('keeps the newest token across folds of a log larger than its window', () => {
    const s = new ResetTokenScanner({ email: 'owner@bridge.local' }, 2000, 300);
    s.push(block('owner@bridge.local', 'tok-first'));
    for (let i = 0; i < 50; i += 1) s.push('x'.repeat(100) + '\n');
    expect(s.result()).toBe('tok-first');
    s.push(block('owner@bridge.local', 'tok-second'));
    for (let i = 0; i < 50; i += 1) s.push('y'.repeat(100) + '\n');
    expect(s.result()).toBe('tok-second');
  });
});
