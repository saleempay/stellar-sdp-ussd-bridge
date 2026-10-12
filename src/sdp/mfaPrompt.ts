/**
 * The operator prompt for an SDP multi-factor code. The code is typed on
 * standard input when the SDP asks for it; it is never read from a file,
 * an argument or an environment variable, where it could end up in a log
 * or a shell history. Nothing typed here is logged or echoed back by the
 * bridge.
 */
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export interface MfaPromptStreams {
  input?: Readable;
  output?: Writable;
}

/** A prompt function for {@link SdpTenantClient.login} `mfaCode`. */
export function promptMfaCode(streams: MfaPromptStreams = {}): (email: string) => Promise<string> {
  return async (email: string) => {
    const rl = createInterface({ input: streams.input ?? process.stdin, output: streams.output ?? process.stderr, terminal: false });
    try {
      const answer = await rl.question(`SDP asked for the verification code it emailed to ${email}. Type it and press Enter: `);
      const code = answer.trim();
      if (!code) throw new Error('no verification code was entered');
      return code;
    } finally {
      rl.close();
    }
  };
}
