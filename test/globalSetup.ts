/**
 * Rebuild dist/ once before every test run. The scripts under scripts/
 * import ../dist/index.js and several tests spawn them; before this setup
 * existed, one test file built dist/ only when it was missing, so a run
 * could use a stale build from an earlier commit, and in CI (which never
 * built) a test that spawned a script could fail depending on the order
 * files ran in (review of 13 October 2026, pull request #10, finding 1).
 */
import { spawnSync } from 'node:child_process';

export default function setup(): void {
  const b = spawnSync('npm', ['run', '-s', 'build'], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error(`build before tests failed:\n${b.stderr}`);
}
