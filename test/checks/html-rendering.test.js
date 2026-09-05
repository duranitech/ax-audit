import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/html-rendering.js';
import { mockContext } from '../helpers.js';

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';

function richHtml(extra = '') {
  const text = FILLER.repeat(20);
  return `
<!DOCTYPE html>
<html lang="en">
  <head><title>Example</title><meta name="description" content="A test page"></head>
  <body>
    <header><nav>Top nav</nav></header>
    <main>
      <article>
        <h1>Welcome to Example</h1>
        <p>${text}</p>
        <p>${text}</p>
        <img src="a.png" alt="A">
        <img src="b.png" alt="B">
      </article>
      <section><p>${text}</p></section>
    </main>
    <footer>Foot</footer>
    ${extra}
  </body>
</html>`;
}

describe('html-rendering', () => {
  it('should fail with score 0 when no HTML is provided', async () => {
    const ctx = mockContext({}, { html: '' });
    const result = await check(ctx);
    assert.equal(result.score, 0);
    assert.equal(result.findings[0].status, 'fail');
  });

  it('should score high for a fully server-rendered semantic page', async () => {
    const ctx = mockContext({}, { html: richHtml() });
    const result = await check(ctx);
    assert.ok(result.score >= 90, `expected >=90 got ${result.score}`);
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('Server-rendered')));
    assert.ok(result.findings.some((f) => f.status === 'pass' && f.message.includes('landmarks')));
  });

  it('should detect an empty SPA shell (#root)', async () => {
    const html = `<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.score < 50, `expected <50 got ${result.score}`);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('Empty SPA mount')));
  });

  it('should detect an empty Next.js shell (#__next)', async () => {
    const html = `<!doctype html><html><body><div id="__next"></div></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('__next')));
  });

  it('should warn on sparse but non-empty content', async () => {
    const html = `<!doctype html><html><body><main><h1>Hi</h1><p>Tiny</p></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.toLowerCase().includes('sparse')));
  });

  it('should warn when only one semantic landmark is present', async () => {
    const text = FILLER.repeat(20);
    const html = `<!doctype html><html><body><main><h1>Hi</h1><p>${text}</p></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('semantic landmark')));
  });

  it('should warn on multiple <h1> headings', async () => {
    const text = FILLER.repeat(20);
    const html = `<!doctype html><html><body><main><h1>One</h1><h1>Two</h1><p>${text}</p><article>x</article><header>x</header></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('<h1> headings found')));
  });

  it('should warn when there is no <h1>', async () => {
    const text = FILLER.repeat(20);
    const html = `<!doctype html><html><body><main><h2>Sub</h2><p>${text}</p><article>x</article><header>x</header></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('No <h1>')));
  });

  it('should warn when many <img> lack alt attributes', async () => {
    const text = FILLER.repeat(20);
    const html = `<!doctype html><html><body>
      <main>
        <h1>Title</h1>
        <p>${text}</p>
        <article>
          <img src="1.png">
          <img src="2.png">
          <img src="3.png">
          <img src="4.png" alt="ok">
        </article>
        <header>x</header>
      </main>
    </body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.status === 'warn' && f.message.includes('alt attributes')));
  });

  it('should suggest <noscript> when JS is heavy and noscript missing', async () => {
    const text = FILLER.repeat(40);
    const scripts = Array.from({ length: 20 }, (_, i) => `<script src="${i}.js"></script>`).join('');
    const html = `<!doctype html><html><body>${scripts}<main><h1>X</h1><p>${text}</p><article>x</article><header>x</header></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('<noscript>')));
  });


  it('should not count a hydration payload against the text-to-markup ratio', async () => {
    // A framework page: solid text, plus an inline data payload fifty
    // times its size. Measured against the raw document this page sat
    // near 1% and took the ratio penalty for its framework, not its
    // content.
    const payload = `<script>self.__DATA__=${'"x"'.repeat(2000)}</script>`;
    const ctx = mockContext({}, { html: richHtml(payload) });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('ratio is healthy'));
    assert.ok(finding, 'the ratio is measured against structural markup');
  });

  it('should not count svg drawing data against the text-to-markup ratio', async () => {
    const paths = Array.from({ length: 40 }, () => `<path d="${'M0 0L1 1 '.repeat(200)}"/>`).join('');
    const ctx = mockContext({}, { html: richHtml(`<svg viewBox="0 0 24 24">${paths}</svg>`) });
    const result = await check(ctx);
    assert.ok(result.findings.some((f) => f.message.includes('ratio is healthy')));
  });

  it('should note a markup-heavy page without charging it when the text is there', async () => {
    // Enough words to prove the page is no shell, wrapped in far more
    // structural markup than 5% allows. The warn survives; the -10 does
    // not: the ratio exists as a shell symptom and the shell is disproven.
    const text = FILLER.repeat(20);
    const wrappers = Array.from({ length: 900 }, (_, i) => `<div class="w-full max-w-screen-xl item-${i}"></div>`).join('');
    const html = `<!doctype html><html><body><header>x</header><nav>x</nav><main><h1>Title</h1><p>${text}</p>${wrappers}</main><footer>x</footer></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('Markup-heavy page'));
    assert.ok(finding, 'the low ratio is still reported');
    assert.equal(finding.status, 'warn');
    assert.equal(result.score, 100, 'and costs nothing when the content thresholds are met');
  });

  it('should still charge a low ratio when the text is sparse too', async () => {
    const wrappers = Array.from({ length: 200 }, () => '<div class="row"><div class="cell"></div></div>').join('');
    const html = `<!doctype html><html><body><header>x</header><nav>x</nav><main><h1>Hi</h1><p>Tiny words here</p>${wrappers}</main><footer>x</footer></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    const finding = result.findings.find((f) => f.message.includes('Low text-to-markup ratio'));
    assert.ok(finding, 'sparse text keeps the ratio penalty');
    assert.ok(result.score <= 65, `sparse (-25) and ratio (-10) both apply, got ${result.score}`);
  });

  it('should not penalize JSON-LD scripts as executable JS', async () => {
    const text = FILLER.repeat(40);
    const ldScripts = Array.from({ length: 20 }, () => `<script type="application/ld+json">{"@context":"https://schema.org"}</script>`).join('');
    const html = `<!doctype html><html><body>${ldScripts}<main><h1>X</h1><p>${text}</p><article>x</article><header>x</header></main></body></html>`;
    const ctx = mockContext({}, { html });
    const result = await check(ctx);
    assert.ok(!result.findings.some((f) => f.message.includes('<noscript>')));
  });

  it('should clamp score to 0 minimum', async () => {
    const ctx = mockContext({}, { html: '<html><body></body></html>' });
    const result = await check(ctx);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });

  it('should never return score above 100', async () => {
    const ctx = mockContext({}, { html: richHtml() });
    const result = await check(ctx);
    assert.ok(result.score <= 100);
  });
});
