import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse, detectEdgeVendor, INCONCLUSIVE_CAVEAT } from '../../dist/checks/waf.js';
import { mockResponse } from '../helpers.js';

const res = (o) => mockResponse({ ok: (o.status ?? 200) >= 200 && (o.status ?? 200) < 300, ...o });

describe('waf: edge vendor detection', () => {
  it('should identify Cloudflare from cf-ray or the server header', () => {
    assert.equal(detectEdgeVendor({ 'cf-ray': 'abc123' }), 'Cloudflare');
    assert.equal(detectEdgeVendor({ server: 'cloudflare' }), 'Cloudflare');
  });

  it('should identify Vercel, AWS, Fastly, Akamai and Netlify', () => {
    assert.equal(detectEdgeVendor({ 'x-vercel-id': 'iad1::abc' }), 'Vercel');
    assert.equal(detectEdgeVendor({ 'x-amz-cf-id': 'abc' }), 'AWS');
    assert.equal(detectEdgeVendor({ 'x-served-by': 'cache-lax-1' }), 'Fastly');
    assert.equal(detectEdgeVendor({ 'x-akamai-transformed': '9 0 0' }), 'Akamai');
    assert.equal(detectEdgeVendor({ server: 'Netlify' }), 'Netlify');
  });

  it('should return undefined for an unremarkable origin', () => {
    assert.equal(detectEdgeVendor({ server: 'nginx' }), undefined);
    assert.equal(detectEdgeVendor({}), undefined);
  });
});

describe('waf: challenges are inconclusive, not blocks', () => {
  it('should detect a Cloudflare challenge from cf-mitigated', () => {
    const c = classifyResponse(res({ status: 403, headers: { 'cf-mitigated': 'challenge' } }));
    assert.equal(c.kind, 'challenge');
    assert.equal(c.vendor, 'Cloudflare');
    assert.equal(c.inconclusive, true);
    assert.deepEqual(c.evidence, ['cf-mitigated: challenge']);
  });

  it('should detect a Cloudflare challenge regardless of status code', () => {
    for (const status of [403, 503, 200]) {
      assert.equal(classifyResponse(res({ status, headers: { 'cf-mitigated': 'challenge' } })).kind, 'challenge');
    }
  });

  it('should detect a Vercel checkpoint from either header', () => {
    assert.equal(classifyResponse(res({ status: 403, headers: { 'x-vercel-mitigated': 'challenge' } })).vendor, 'Vercel');
    const byToken = classifyResponse(res({ status: 200, headers: { 'x-vercel-challenge-token': 'tok' } }));
    assert.equal(byToken.kind, 'challenge');
    assert.equal(byToken.vendor, 'Vercel');
  });

  it('should detect an AWS WAF challenge on HTTP 202', () => {
    const c = classifyResponse(res({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }));
    assert.equal(c.kind, 'challenge');
    assert.equal(c.vendor, 'AWS WAF');
    assert.ok(c.label.includes('202'), 'a 202 challenge reads as success unless the status is stated');
  });

  it('should detect challenge interstitials from body markup', () => {
    const cases = [
      ['<html><head><title>Just a moment...</title></head></html>', 'Cloudflare'],
      ['<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>', 'Cloudflare'],
      ['<h1>Vercel Security Checkpoint</h1>', 'Vercel'],
      ['<script src="https://www.google.com/recaptcha/api.js"></script>', 'reCAPTCHA'],
      ['<script src="https://js.hcaptcha.com/1/api.js"></script>', 'hCaptcha'],
      ['<div>Pardon Our Interruption</div>', 'Imperva'],
      ['<div>px-captcha</div>', 'HUMAN (PerimeterX)'],
    ];
    for (const [body, vendor] of cases) {
      const c = classifyResponse(res({ status: 200, body }));
      assert.equal(c.kind, 'challenge', `body should read as a challenge: ${body.slice(0, 40)}`);
      assert.equal(c.vendor, vendor);
      assert.equal(c.inconclusive, true);
    }
  });

  it('should not mistake ordinary content for a challenge', () => {
    const c = classifyResponse(res({ status: 200, body: '<html><body><h1>Docs</h1><p>Just a moment please, read on.</p></body></html>' }));
    assert.equal(c.kind, 'ok');
  });
});

describe('waf: payment and licensing are offers, not refusals', () => {
  it('should read a Cloudflare pay-per-crawl price', () => {
    const c = classifyResponse(res({ status: 402, headers: { 'crawler-price': 'USD 0.01' } }));
    assert.equal(c.kind, 'paywall');
    assert.equal(c.price, 'USD 0.01');
    assert.equal(c.inconclusive, false);
    assert.ok(c.label.includes('USD 0.01'));
  });

  it('should detect x402 monetization from the header or the body', () => {
    assert.equal(classifyResponse(res({ status: 402, headers: { 'payment-signature': 'sig' } })).kind, 'paywall');
    const byBody = classifyResponse(res({ status: 402, body: '{"x402Version":1,"payTo":"0xabc"}' }));
    assert.equal(byBody.kind, 'paywall');
  });

  it('should detect an RSL licence challenge on 401 and 402', () => {
    for (const status of [401, 402]) {
      const c = classifyResponse(
        res({ status, headers: { 'www-authenticate': 'License error="invalid_token"' } }),
      );
      assert.equal(c.kind, 'license-required', `status ${status}`);
      assert.equal(c.inconclusive, false);
    }
  });

  it('should treat a bare 402 with no mechanism as a block', () => {
    const c = classifyResponse(res({ status: 402, body: 'Payment Required' }));
    assert.equal(c.kind, 'blocked');
    assert.ok(c.evidence[0].includes('no crawler-price'));
  });

  it('should not confuse a Bearer challenge with a licence challenge', () => {
    const c = classifyResponse(res({ status: 401, headers: { 'www-authenticate': 'Bearer realm="api"' } }));
    assert.equal(c.kind, 'blocked');
  });
});

describe('waf: signature demands and rate limits', () => {
  it('should detect a Web Bot Auth requirement', () => {
    const c = classifyResponse(res({ status: 403, headers: { 'accept-signature': 'sig1=("@authority")' } }));
    assert.equal(c.kind, 'needs-signature');
    assert.equal(c.inconclusive, true, 'an unsigned probe cannot prove the real agent is refused');
  });

  it('should report a rate limit with its Retry-After', () => {
    const c = classifyResponse(res({ status: 429, headers: { 'retry-after': '60' } }));
    assert.equal(c.kind, 'rate-limited');
    assert.ok(c.label.includes('60'));
  });

  it('should still classify a 429 without Retry-After', () => {
    assert.equal(classifyResponse(res({ status: 429 })).kind, 'rate-limited');
  });
});

describe('waf: plain outcomes', () => {
  it('should classify a normal 200', () => {
    const c = classifyResponse(res({ status: 200, body: '<html><body>Hi</body></html>' }));
    assert.equal(c.kind, 'ok');
    assert.equal(c.inconclusive, false);
  });

  it('should treat a bare 403 from an unremarkable origin as conclusive', () => {
    const c = classifyResponse(res({ status: 403, headers: { server: 'nginx' } }));
    assert.equal(c.kind, 'blocked');
    assert.equal(c.inconclusive, false);
  });

  it('should treat a bare 403 from a bot-managing CDN as inconclusive', () => {
    const c = classifyResponse(res({ status: 403, headers: { 'cf-ray': 'abc' } }));
    assert.equal(c.kind, 'blocked');
    assert.equal(c.vendor, 'Cloudflare');
    assert.equal(c.inconclusive, true, 'an IP-verifying edge rejects unsigned probes on principle');
  });

  it('should classify 404, 410, 5xx and network errors', () => {
    assert.equal(classifyResponse(res({ status: 404 })).kind, 'not-found');
    assert.equal(classifyResponse(res({ status: 410 })).kind, 'not-found');
    assert.equal(classifyResponse(res({ status: 503 })).kind, 'server-error');
    const net = classifyResponse(res({ status: 0, ok: false, error: 'Request timed out' }));
    assert.equal(net.kind, 'network-error');
    assert.ok(net.label.includes('Request timed out'));
    assert.equal(net.inconclusive, true);
  });

  it('should never throw on a malformed response object', () => {
    assert.doesNotThrow(() => classifyResponse({ status: 200, ok: true, url: '', headers: undefined, body: undefined }));
    const c = classifyResponse({ status: 418, ok: false, url: '', headers: {}, body: '' });
    assert.equal(c.kind, 'blocked');
  });

  it('should ship a caveat that names the limits of an unsigned probe', () => {
    assert.match(INCONCLUSIVE_CAVEAT, /Web Bot Auth/);
    assert.match(INCONCLUSIVE_CAVEAT, /WAF logs/);
  });
});
