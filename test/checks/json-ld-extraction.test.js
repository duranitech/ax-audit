import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findJsonLdBlocks } from '../../dist/checks/html-utils.js';
import structuredData from '../../dist/checks/structured-data.js';
import { hasCommerceSignals } from '../../dist/checks/commerce-discovery.js';
import { mockContext } from '../helpers.js';

describe('JSON-LD extraction: attribute order', () => {
  it('should find a block whose type is the first attribute', () => {
    const html = '<script type="application/ld+json">{"@type":"Organization"}</script>';
    assert.deepEqual(findJsonLdBlocks(html), ['{"@type":"Organization"}']);
  });

  it('should find a block with attributes before type', () => {
    // How Next.js and several other frameworks emit it. A pattern anchored on
    // `<script type=` misses this entirely and reports "no structured data".
    const html = '<script id="org-json-ld" type="application/ld+json">{"@type":"Organization"}</script>';
    assert.deepEqual(findJsonLdBlocks(html), ['{"@type":"Organization"}']);
  });

  it('should find several blocks in one document', () => {
    const html = [
      '<script id="a" type="application/ld+json">{"@type":"Organization"}</script>',
      '<script type="application/ld+json" id="b">{"@type":"WebSite"}</script>',
    ].join('\n');
    assert.equal(findJsonLdBlocks(html).length, 2);
  });

  it('should tolerate single quotes, spacing and mixed case', () => {
    const html = "<script  nonce=\"x\"  TYPE = 'APPLICATION/LD+JSON' >{\"@type\":\"Person\"}</script>";
    assert.equal(findJsonLdBlocks(html).length, 1);
  });

  it('should ignore executable scripts and other data blocks', () => {
    const html = [
      '<script>var x = 1;</script>',
      '<script type="text/javascript">var y = 2;</script>',
      '<script type="application/json">{"not":"ld"}</script>',
      '<script type="application/ld+json">{"@type":"Person"}</script>',
    ].join('\n');
    assert.deepEqual(findJsonLdBlocks(html), ['{"@type":"Person"}']);
  });

  it('should return nothing for a document with no structured data', () => {
    assert.deepEqual(findJsonLdBlocks('<html><body><p>Hi</p></body></html>'), []);
  });
});

describe('JSON-LD extraction: consumers', () => {
  const REAL_WORLD = `<html><head>
    <script id="vercel-organization-json-ld" type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization","name":"Acme","sameAs":["https://wikidata.org/Q1"]}
    </script>
    <script id="vercel-website-json-ld" type="application/ld+json">
      {"@context":"https://schema.org","@type":"WebSite","name":"Acme"}
    </script>
    </head><body><main>${'Content. '.repeat(30)}</main></body></html>`;

  it('should no longer report structured data as missing when type is not the first attribute', async () => {
    const result = await structuredData(mockContext({}, { html: REAL_WORLD }));
    assert.ok(result.score > 0, 'a site with two valid JSON-LD blocks must not score 0');
    assert.ok(result.findings.some((f) => f.message.includes('2 JSON-LD block(s) found')));
    assert.ok(!result.findings.some((f) => f.message.includes('No JSON-LD structured data found')));
  });

  it('should detect commerce signals regardless of attribute order', () => {
    const shop = '<script id="p" type="application/ld+json">{"@type":"Product","name":"Widget"}</script>';
    assert.equal(hasCommerceSignals(shop).found, true);
  });
});
