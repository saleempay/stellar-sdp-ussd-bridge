/**
 * The bridge's USSD step machine: one gateway callback in, one screen out.
 *
 * Menu: docs/ussd-menu-walkthrough-v1.md with the deviations in
 * docs/walkthrough-deviations.md. Three entry states on "1. My account":
 *
 *   no account, no PIN          screens 2, 3, 4, (create), 5, 6 path, 7
 *   account, no PIN (D2)        screens 2, 3, then 7 directly (D-1)
 *   account and PIN             screen 6, then 7
 *
 * What is the adapter's, by import: the session record and store (with its
 * TTL and idempotency cache), the PIN policy (hash, lockout, weak list),
 * MSISDN inference, the account store, the screen budget. The session
 * lifecycle in handleBridgeStep (create on dial, duplicate re-prompt, PIN
 * positions masked before anything is persisted) follows the adapter's
 * machine (src/ussd/menu/machine.ts at 5a3c8dc); the per-state logic is
 * this file's own because the screens and the final step differ.
 *
 * PIN wording (adapter issue #9): "PIN saved" is rendered only by the
 * callback that stored the hash; "PIN accepted" only after verifyPinAttempt
 * succeeded. Setup is reached only when no record exists, so a stored PIN
 * is never replaced. Nothing in this flow signs anything, so there is no
 * signing claim; a replayed final callback is answered from the listener's
 * cache.
 */
import {
  PinLockedError,
  PinRejectedError,
  establishPin,
  hasPin,
  inferE164,
  isWeakPin,
  isWellFormedPin,
  verifyPinAttempt,
  type AccountStore,
  type GatewayStep,
  type MenuState,
  type MsisdnInferenceConfig,
  type PinStore,
  type Screen,
  type SessionStore,
  type UssdSession,
} from 'stellar-ussd-sep10-adapter';
import { AccountNotOnChainError, NoUsdcTrustlineError } from './errors.js';
import { SCREENS, type AccountView } from './screens.js';

export interface BridgeMachineDeps {
  sessions: SessionStore;
  pins: PinStore;
  accounts: AccountStore;
  /** The account screen's data; throws AccountNotOnChainError, NoUsdcTrustlineError or a transport error. */
  loadView: (accountId: string) => Promise<AccountView>;
  /**
   * Sponsored account creation on dial. Undefined means creation on dial is
   * off (USSD_CREATE_ON_DIAL=false, the operator-provisioned posture): a
   * number with no account gets E3.
   */
  createAccount?: (msisdn: string) => Promise<{ accountId: string; creationTxHash?: string }>;
  msisdn: MsisdnInferenceConfig;
  now?: () => number;
  /** Event sink: state names and event codes only, never user input. */
  log?: (line: string) => void;
}

const PIN_MASK = '####';
const PIN_STATES: ReadonlySet<MenuState> = new Set(['pinSetup1', 'pinSetup2', 'pinEnter']);

export async function handleBridgeStep(deps: BridgeMachineDeps, step: GatewayStep): Promise<Screen> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? (() => undefined);
  let session = await deps.sessions.get(step.sessionId, now);

  if (step.inputs.length === 0) {
    if (session === undefined) {
      session = {
        sessionId: step.sessionId,
        msisdn: inferE164(step.msisdnRaw, deps.msisdn),
        state: 'welcome',
        processedInputs: 0,
        maskedHistory: [],
        pinVerified: false,
        signingClaimed: false,
        createdAt: now,
        lastSeenAt: now,
      };
      await deps.sessions.put(session);
      log(`session=${step.sessionId} event=start state=welcome`);
    }
    return SCREENS.mainMenu();
  }
  if (session === undefined) {
    log(`session=${step.sessionId} event=expired`);
    return SCREENS.endExpired();
  }
  if (step.inputs.length <= session.processedInputs) {
    log(`session=${step.sessionId} event=duplicate state=${session.state}`);
    return session.state === 'done' ? SCREENS.endExpired() : promptFor(session);
  }

  const input = step.inputs[step.inputs.length - 1] ?? '';
  const stateBefore = session.state;
  const screen = await transition(deps, session, step, input, now, log);
  session.processedInputs = step.inputs.length;
  session.maskedHistory.push(PIN_STATES.has(stateBefore) ? PIN_MASK : input);
  session.lastSeenAt = now;
  if (screen.kind === 'end') session.state = 'done';
  await deps.sessions.put(session);
  log(`session=${step.sessionId} event=step state=${stateBefore}>${session.state}`);
  return screen;
}

async function transition(
  deps: BridgeMachineDeps,
  session: UssdSession,
  step: GatewayStep,
  input: string,
  now: number,
  log: (line: string) => void,
): Promise<Screen> {
  switch (session.state) {
    case 'welcome': {
      if (input === '2') return SCREENS.about();
      if (input !== '1') return SCREENS.invalidChoice(SCREENS.mainMenu());
      session.accountId = await deps.accounts.get(session.msisdn);
      const pinExists = await hasPin({ store: deps.pins }, session.msisdn);
      if (pinExists) {
        if (session.accountId === undefined && !deps.createAccount) {
          log(`session=${session.sessionId} event=noAccount reason=pinWithoutMapping`);
          return SCREENS.endNoAccount();
        }
        session.state = 'pinEnter';
        return SCREENS.pinEnter();
      }
      if (session.accountId === undefined && !deps.createAccount) {
        log(`session=${session.sessionId} event=noAccount reason=creationOff`);
        return SCREENS.endNoAccount();
      }
      session.state = 'pinSetup1';
      return SCREENS.pinSetup1();
    }
    case 'pinSetup1': {
      if (!isWellFormedPin(input)) return SCREENS.pinSetupBadFormat();
      if (isWeakPin(input)) {
        log(`session=${session.sessionId} event=pinSetupWeakRejected`);
        return SCREENS.pinSetupWeak();
      }
      session.state = 'pinSetup2';
      return SCREENS.pinSetup2();
    }
    case 'pinSetup2': {
      const first = step.inputs[step.inputs.length - 2];
      if (first === undefined || input !== first || !isWellFormedPin(input)) {
        session.state = 'pinSetup1';
        return SCREENS.pinSetupMismatch();
      }
      await establishPin({ store: deps.pins, now: () => now }, session.msisdn, input);
      log(`session=${session.sessionId} event=pinSaved`);
      if (session.accountId !== undefined) {
        // D-1: a provisioned recipient goes straight to the account screen.
        return renderAccount(deps, session, now, 'provisioned', log);
      }
      session.state = 'accountPrompt';
      return SCREENS.pinSaved();
    }
    case 'accountPrompt': {
      const prompt = session.pinVerified ? SCREENS.pinAccepted() : SCREENS.pinSaved();
      if (input !== '1') return SCREENS.invalidChoice(prompt);
      if (session.accountId === undefined) {
        if (!deps.createAccount) return SCREENS.endNoAccount();
        try {
          const created = await deps.createAccount(session.msisdn);
          session.accountId = created.accountId;
          log(`session=${session.sessionId} event=accountCreated tx=${created.creationTxHash ?? 'none'}`);
        } catch (err) {
          log(`session=${session.sessionId} event=accountCreateFailed code=${(err as { code?: string })?.code ?? (err as Error)?.name ?? 'unknown'}`);
          return SCREENS.endServiceDown();
        }
      }
      session.state = 'pinEnter';
      return SCREENS.accountReady();
    }
    case 'pinEnter': {
      if (!isWellFormedPin(input)) return SCREENS.pinEnterBadFormat();
      try {
        await verifyPinAttempt({ store: deps.pins, now: () => now }, session.msisdn, input);
      } catch (err) {
        if (err instanceof PinRejectedError) {
          log(`session=${session.sessionId} event=pinRejected left=${err.attemptsLeft}`);
          return SCREENS.pinWrong(err.attemptsLeft);
        }
        if (err instanceof PinLockedError) {
          log(`session=${session.sessionId} event=pinLocked`);
          return SCREENS.endLocked();
        }
        throw err;
      }
      session.pinVerified = true;
      log(`session=${session.sessionId} event=pinVerified`);
      if (session.accountId === undefined) {
        session.state = 'accountPrompt';
        return SCREENS.pinAccepted();
      }
      return renderAccount(deps, session, now, 'returning', log);
    }
    case 'done':
      return SCREENS.endExpired();
  }
}

async function renderAccount(
  deps: BridgeMachineDeps,
  session: UssdSession,
  now: number,
  path: 'provisioned' | 'returning',
  log: (line: string) => void,
): Promise<Screen> {
  const accountId = session.accountId!;
  try {
    const view = await deps.loadView(accountId);
    log(`session=${session.sessionId} event=accountScreen path=${path} hasLastReceived=${view.lastReceived !== undefined}`);
    return SCREENS.account(accountId, view, new Date(now));
  } catch (err) {
    if (err instanceof AccountNotOnChainError) {
      log(`session=${session.sessionId} event=accountNotOnChain`);
      return SCREENS.endNoAccount();
    }
    if (err instanceof NoUsdcTrustlineError) {
      log(`session=${session.sessionId} event=noTrustline`);
      return SCREENS.endNoTrustline();
    }
    log(`session=${session.sessionId} event=viewFailed code=${(err as { code?: string })?.code ?? (err as Error)?.name ?? 'unknown'}`);
    return SCREENS.endServiceDown();
  }
}

/** The prompt of the current state, for harmless duplicate callbacks. */
function promptFor(session: UssdSession): Screen {
  switch (session.state) {
    case 'welcome':
      return SCREENS.mainMenu();
    case 'pinSetup1':
      return SCREENS.pinSetup1();
    case 'pinSetup2':
      return SCREENS.pinSetup2();
    case 'accountPrompt':
      return session.pinVerified ? SCREENS.pinAccepted() : SCREENS.pinSaved();
    case 'pinEnter':
      return SCREENS.pinEnter();
    case 'done':
      return SCREENS.endExpired();
  }
}
