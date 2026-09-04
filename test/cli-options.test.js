import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseCategoryThresholds } from '../dist/cli.js';

/** Run the CLI and capture both streams, whatever the exit code. */
function run(args) {
  const r = spawnSync('node', ['bin/ax-audit.js', ...args], { encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('cli: --fail-on-category parsing', () => {
  it('should parse one pair', () => {
    const { thresholds, error } = parseCategoryThresholds('access:70');
    assert.equal(error, undefined);
    assert.equal(thresholds.get('access'), 70);
  });

  it('should parse several pairs', () => {
    const { thresholds } = parseCategoryThresholds('access:70, content:80');
    assert.equal(thresholds.size, 2);
    assert.equal(thresholds.get('content'), 80);
  });

  it('should reject an unknown area', () => {
    const { error } = parseCategoryThresholds('speed:70');
    assert.match(error, /Unknown category "speed"/);
  });

  it('should reject a threshold outside 0-100 or non-integer', () => {
    assert.match(parseCategoryThresholds('access:150').error, /between 0 and 100/);
    assert.match(parseCategoryThresholds('access:-1').error, /between 0 and 100/);
    assert.match(parseCategoryThresholds('access:seventy').error, /between 0 and 100/);
  });

  it('should reject an empty specification', () => {
    assert.match(parseCategoryThresholds('').error, /at least one area:score pair/);
  });

  it('should accept 0 and 100 as thresholds', () => {
    assert.equal(parseCategoryThresholds('access:0').thresholds.get('access'), 0);
    assert.equal(parseCategoryThresholds('access:100').thresholds.get('access'), 100);
  });
});

describe('cli: option validation', () => {
  it('should reject an unknown profile', () => {
    const r = run(['https://example.com', '--profile', 'nonsense']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown profile "nonsense"/);
  });

  it('should accept every documented profile name', () => {
    for (const profile of ['auto', 'api', 'mcp', 'agent', 'docs', 'commerce', 'all']) {
      const r = run(['https://example.com', '--profile', profile, '--checks', 'tls-https', '--output', 'json']);
      assert.notEqual(r.code, 1, `${profile} should be accepted`);
    }
  });

  it('should reject an unknown category', () => {
    const r = run(['https://example.com', '--category', 'speed']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown categor/);
  });

  it('should reject a category and check selection that cannot overlap', () => {
    const r = run(['https://example.com', '--category', 'access', '--checks', 'llms-txt']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No checks match/);
  });

  it('should reject a malformed --fail-on-category', () => {
    const r = run(['https://example.com', '--fail-on-category', 'speed:70']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown category/);
  });

  it('should run only the checks in the requested area', () => {
    const r = run(['https://example.com', '--category', 'policy', '--output', 'json']);
    const ids = JSON.parse(r.stdout).results.map((c) => c.id).sort();
    assert.deepEqual(ids, ['rsl', 'security-txt', 'usage-policy']);
  });

  it('should narrow an explicit check list to the requested area', () => {
    const r = run(['https://example.com', '--category', 'policy', '--checks', 'rsl,llms-txt', '--output', 'json']);
    const ids = JSON.parse(r.stdout).results.map((c) => c.id);
    assert.deepEqual(ids, ['rsl']);
  });

  it('should report each area against its threshold and fail when one is below', () => {
    const r = run(['https://example.com', '--category', 'access', '--fail-on-category', 'access:100']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /access: \d+ is below the threshold of 100/);
  });

  it('should pass when every area meets its threshold', () => {
    const r = run(['https://example.com', '--category', 'access', '--fail-on-category', 'access:0']);
    assert.match(r.stderr, /meets the threshold of 0/);
  });

  it('should say an area was not evaluated rather than failing it', () => {
    const r = run([
      'https://example.com',
      '--checks',
      'tls-https',
      '--fail-on-category',
      'protocols:90',
      '--output',
      'json',
    ]);
    assert.match(r.stderr, /protocols: n\/a \(no applicable checks\)/);
    assert.notEqual(r.code, 1, 'an area with nothing to judge must not fail the build');
  });
});
