import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { analyseOperability } from '../../dist/checks/agent-operability.js';
import { mockContext } from '../helpers.js';

const page = (body, head = '') => `<html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;
const ctx = (body, head = '') => mockContext({}, { html: page(body, head) });

const CLEAN = `
  <h1>Docs</h1>
  <h2>Search</h2>
  <form>
    <label for="q">Query</label><input id="q" name="q">
    <button type="submit">Search</button>
  </form>
  <a href="/docs">Documentation</a>
`;

describe('agent-operability: accessible names', () => {
  it('should count a button named by its text', () => {
    const r = analyseOperability(page('<button>Search</button>'));
    assert.equal(r.buttons.total, 1);
    assert.equal(r.buttons.named, 1);
  });

  it('should accept aria-label, title, alt text and an SVG title as names', () => {
    for (const markup of [
      '<button aria-label="Search"></button>',
      '<button title="Search"></button>',
      '<button><img src="s.svg" alt="Search"></button>',
      '<button><svg><title>Search</title></svg></button>',
    ]) {
      assert.equal(analyseOperability(page(markup)).buttons.named, 1, markup);
    }
  });

  it('should flag a button with nothing to name it', () => {
    const r = analyseOperability(page('<button><svg></svg></button>'));
    assert.equal(r.buttons.named, 0);
  });

  it('should name an input button by its value or alt', () => {
    assert.equal(analyseOperability(page('<input type="submit" value="Go">')).buttons.named, 1);
    assert.equal(analyseOperability(page('<input type="submit">')).buttons.named, 0);
  });

  it('should count links as interactive elements needing a name', () => {
    const r = analyseOperability(page('<a href="/x">Docs</a><a href="/y"></a>'));
    assert.equal(r.buttons.total, 2);
    assert.equal(r.buttons.named, 1);
  });

  it('should not count a link that leads nowhere as nameable', () => {
    const r = analyseOperability(page('<a>No href</a><a href="javascript:void(0)">JS</a>'));
    assert.equal(r.deadLinks.noHref, 1);
    assert.equal(r.deadLinks.javascriptHref, 1);
    assert.equal(r.buttons.total, 0);
  });

  it('should ignore markup inside comments, scripts and styles', () => {
    const r = analyseOperability(page('<!-- <button></button> --><script>"<button></button>"</script><button>Real</button>'));
    assert.equal(r.buttons.total, 1);
  });
});

describe('agent-operability: form labels', () => {
  it('should accept a label referencing the control by id', () => {
    const r = analyseOperability(page('<label for="q">Query</label><input id="q">'));
    assert.equal(r.controls.labelled, 1);
  });

  it('should accept a wrapping label', () => {
    const r = analyseOperability(page('<label>Query <input name="q"></label>'));
    assert.equal(r.controls.total, 1);
    assert.equal(r.controls.labelled, 1);
  });

  it('should accept aria-label and title', () => {
    assert.equal(analyseOperability(page('<input aria-label="Query">')).controls.labelled, 1);
    assert.equal(analyseOperability(page('<input title="Query">')).controls.labelled, 1);
  });

  it('should flag a control with no label at all', () => {
    const r = analyseOperability(page('<input name="q" placeholder="Search">'));
    assert.equal(r.controls.labelled, 0, 'a placeholder is not a label');
  });

  it('should ignore hidden and button inputs', () => {
    const r = analyseOperability(page('<input type="hidden" name="csrf"><input type="submit" value="Go">'));
    assert.equal(r.controls.total, 0);
  });

  it('should cover select and textarea', () => {
    const r = analyseOperability(page('<select name="a"></select><textarea name="b"></textarea>'));
    assert.equal(r.controls.total, 2);
  });
});

describe('agent-operability: structure', () => {
  it('should detect a div dressed as a button', () => {
    assert.equal(analyseOperability(page('<div onclick="go()">Go</div>')).fakeInteractive, 1);
  });

  it('should accept a div with a role and tabindex', () => {
    assert.equal(analyseOperability(page('<div onclick="go()" role="button" tabindex="0">Go</div>')).fakeInteractive, 0);
  });

  it('should count tables with and without header cells', () => {
    const r = analyseOperability(page('<table><tr><th>A</th></tr></table><table><tr><td>B</td></tr></table>'));
    assert.equal(r.tables.total, 2);
    assert.equal(r.tables.withHeaders, 1);
  });

  it('should count media dimensions, accepting aspect-ratio', () => {
    const r = analyseOperability(
      page('<img src="a.png" width="10" height="10"><img src="b.png"><img src="c.png" style="aspect-ratio: 16/9">'),
    );
    assert.equal(r.media.total, 3);
    assert.equal(r.media.sized, 2);
  });

  it('should count iframe titles', () => {
    const r = analyseOperability(page('<iframe title="Map"></iframe><iframe></iframe>'));
    assert.equal(r.iframes.total, 2);
    assert.equal(r.iframes.titled, 1);
  });

  it('should count time elements with a datetime attribute', () => {
    const r = analyseOperability(page('<time datetime="2026-09-04">today</time><time>last Tuesday</time>'));
    assert.equal(r.timeElements.total, 2);
    assert.equal(r.timeElements.withDatetime, 1);
  });

  it('should detect skipped heading levels but not descents', () => {
    assert.deepEqual(analyseOperability(page('<h1>A</h1><h3>B</h3>')).headingSkips, ['h1 → h3']);
    assert.deepEqual(analyseOperability(page('<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>')).headingSkips, []);
  });

  it('should read the lang attribute', () => {
    assert.equal(analyseOperability(page('<p>x</p>')).lang, 'en');
    assert.equal(analyseOperability('<html><body><p>x</p></body></html>').lang, null);
  });

  it('should detect entry blockers', () => {
    assert.ok(analyseOperability(page('<p>x</p>', '<meta http-equiv="refresh" content="0;url=/x">')).blockers.length > 0);
    assert.ok(
      analyseOperability(page('<script src="https://www.google.com/recaptcha/api.js"></script>')).blockers.length > 0,
    );
  });
});

describe('agent-operability: findings', () => {
  it('should score a clean page 100', async () => {
    const result = await check(ctx(CLEAN));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('interactive elements have an accessible name')));
    assert.ok(result.findings.some((f) => f.message.includes('form controls are labelled')));
  });

  it('should always state what a static read cannot see', async () => {
    const result = await check(ctx(CLEAN));
    const finding = result.findings.find((f) => f.message.includes('Method note'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('rendered accessibility tree') || finding.message.includes('accessibility tree'));
    assert.ok(finding.detail.includes('accessibility defect'));
  });

  it('should warn about unnamed controls with the reason an agent needs them', async () => {
    const result = await check(ctx('<button></button><button></button><a href="/x">Docs</a>'));
    const finding = result.findings.find((f) => f.message.includes('no accessible name'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('not the button at 412×88'));
    assert.equal(result.score, 80);
  });

  it('should tolerate a single unnamed control among many', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `<button>Action ${i}</button>`).join('') + '<button></button>';
    const result = await check(ctx(many));
    assert.equal(result.score, 100, '12 of 13 named is above the threshold');
  });

  it('should warn about unlabelled inputs', async () => {
    const result = await check(ctx('<input name="a"><input name="b">'));
    const finding = result.findings.find((f) => f.message.includes('no label'));
    assert.ok(finding.hint.includes('email address ends up in a search field'));
    assert.equal(result.score, 80);
  });

  it('should explain why a fake control is invisible rather than merely wrong', async () => {
    const result = await check(ctx(`${CLEAN}<div onclick="go()">Go</div>`));
    const finding = result.findings.find((f) => f.message.includes('not buttons or links'));
    assert.ok(finding.hint.includes('it sees nothing'));
    assert.equal(result.score, 85);
  });

  it('should warn about links that lead nowhere', async () => {
    const result = await check(ctx(`${CLEAN}<a href="javascript:void(0)">Go</a>`));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('lead nowhere without JavaScript')));
  });

  it('should warn about headerless tables with the consequence stated', async () => {
    const result = await check(ctx(`${CLEAN}<table><tr><td>9.99</td></tr></table>`));
    const finding = result.findings.find((f) => f.message.includes('no header cells'));
    assert.ok(finding.hint.includes('which column is the price'));
    assert.equal(result.score, 90);
  });

  it('should warn about a missing lang attribute', async () => {
    const result = await check(mockContext({}, { html: `<html><head></head><body>${CLEAN}</body></html>` }));
    assert.equal(result.score, 95);
    assert.ok(result.findings.some((f) => f.message.includes('No lang attribute')));
  });

  it('should warn about entry blockers', async () => {
    const result = await check(ctx(`${CLEAN}<script src="https://www.google.com/recaptcha/api.js"></script>`));
    assert.equal(result.score, 85);
    const finding = result.findings.find((f) => f.message.includes('obstacle(s) on the entry page'));
    assert.ok(finding.hint.includes('not to reading a page'));
  });

  it('should fail cleanly with no HTML', async () => {
    const result = await check(mockContext({}, { html: '' }));
    assert.equal(result.score, 0);
  });
});
