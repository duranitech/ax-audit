import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderBatchMarkdown } from '../../dist/reporter/markdown.js';

function report(overrides = {}) {
  return {
    url: 'https://example.com',
    timestamp: '2026-06-06T00:00:00.000Z',
    overallScore: 82,
    grade: { min: 70, label: 'Good', color: 'yellow' },
    duration: 123,
    results: [
      {
        id: 'llms-txt',
        name: 'LLMs.txt',
        description: '',
        score: 100,
        duration: 5,
        findings: [{ status: 'pass', message: '/llms.txt exists' }],
      },
      {
        id: 'robots-txt',
        name: 'Robots.txt',
        description: '',
        score: 60,
        duration: 5,
        findings: [
          { status: 'warn', message: 'Missing crawler', detail: 'GPTBot', hint: 'Add it' },
          { status: 'fail', message: 'No sitemap' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('markdown reporter', () => {
  it('should render a header with score and grade', () => {
    const md = renderMarkdown(report());
    assert.match(md, /## AX Audit — https:\/\/example\.com/);
    assert.match(md, /\*\*82\/100 · Good\*\*/);
  });

  it('should render a summary table with every check', () => {
    const md = renderMarkdown(report());
    assert.match(md, /\| Check \| Score \|/);
    assert.match(md, /\| LLMs\.txt \| 100\/100 \|/);
    assert.match(md, /\| Robots\.txt \| 60\/100 \|/);
  });

  it('should use status emoji for findings', () => {
    const md = renderMarkdown(report());
    assert.ok(md.includes('✅ /llms.txt exists'));
    assert.ok(md.includes('⚠️ Missing crawler — GPTBot'));
    assert.ok(md.includes('❌ No sitemap'));
  });

  it('should render hints only for non-pass findings', () => {
    const md = renderMarkdown(report());
    assert.ok(md.includes('_Add it_'));
  });

  it('should render baseline deltas when a diff is provided', () => {
    const diff = {
      url: 'https://example.com',
      baselineTimestamp: 'x',
      currentTimestamp: 'y',
      overallPrevious: 75,
      overallCurrent: 82,
      overallDelta: 7,
      checks: [{ id: 'robots-txt', name: 'Robots.txt', previous: 70, current: 60, delta: -10 }],
      regressions: [],
      improvements: [],
    };
    const md = renderMarkdown(report(), diff);
    assert.match(md, /\*\*82\/100 · Good\*\* ▲7/);
    assert.match(md, /\| Robots\.txt \| 60\/100 ▼10 \|/);
  });

  it('should end with a trailing newline', () => {
    assert.ok(renderMarkdown(report()).endsWith('\n'));
  });

  it('should render a batch report with a summary table', () => {
    const batch = {
      reports: [report(), report({ url: 'https://other.com', overallScore: 40, grade: { min: 0, label: 'Poor', color: 'red' } })],
      summary: { total: 2, passed: 1, failed: 1, averageScore: 61, grade: { min: 50, label: 'Fair', color: 'orange' } },
      duration: 200,
    };
    const md = renderBatchMarkdown(batch);
    assert.match(md, /# AX Audit — Batch Report/);
    assert.match(md, /\| https:\/\/example\.com \| 82\/100 \| Good \|/);
    assert.match(md, /\| https:\/\/other\.com \| 40\/100 \| Poor \|/);
    assert.match(md, /2 URLs · 1 passed · 1 failed · 61\/100 avg \(Fair\)/);
  });
});
