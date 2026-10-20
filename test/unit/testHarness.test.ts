/**
 * The test harness itself (review of 13 October 2026, pull request #10,
 * finding 1): dist/ is rebuilt once per run by a vitest global setup, so
 * no test depends on another file's side effect, and CI builds before it
 * tests. These assertions keep both in place.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(process.cwd());

describe('test harness: dist/ is fresh and CI builds before testing', () => {
  it('vitest names the global setup that rebuilds dist/', () => {
    const cfg = readFileSync(resolve(repo, 'vitest.config.ts'), 'utf8');
    expect(cfg).toContain("globalSetup: ['test/globalSetup.ts']");
    expect(existsSync(resolve(repo, 'test', 'globalSetup.ts'))).toBe(true);
  });

  it('dist/index.js exists when the tests run and is not older than the sources it was built from', () => {
    const dist = resolve(repo, 'dist', 'index.js');
    expect(existsSync(dist)).toBe(true);
    const built = statSync(dist).mtimeMs;
    expect(built).toBeGreaterThanOrEqual(statSync(resolve(repo, 'src', 'index.ts')).mtimeMs);
  });

  it('the CI workflow runs npm run build before npm test', () => {
    const ci = readFileSync(resolve(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
    const build = ci.indexOf('npm run build');
    const test = ci.indexOf('npm test');
    expect(build).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(build);
  });

  it('no test file builds dist/ on its own any more', () => {
    const setup = readFileSync(resolve(repo, 'test', 'unit', 'setupScripts.test.ts'), 'utf8');
    expect(setup).not.toContain("'build'");
  });
});
