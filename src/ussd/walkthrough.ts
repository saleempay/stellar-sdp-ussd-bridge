/**
 * Reader for docs/ussd-menu-walkthrough-v1.md: the screen texts the
 * catalogue must match, keyed by the walkthrough's screen ids (1 to 8,
 * E1 to E5). Used by the catalogue test; kept in src so the same parser
 * serves the written notice tooling later.
 */
export function parseWalkthroughScreens(markdown: string): Map<string, string> {
  const screens = new Map<string, string>();
  const re = /^### Screen (\S+)\.[^\n]*\n+```\n([\s\S]*?)\n```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) screens.set(m[1]!, m[2]!);
  return screens;
}
