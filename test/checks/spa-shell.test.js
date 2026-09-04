import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isHtmlDocument } from '../../dist/checks/utils.js';
import agentCard from '../../dist/checks/agent-card.js';
import mcpDiscovery from '../../dist/checks/mcp-discovery.js';
import apiDiscovery from '../../dist/checks/api-discovery.js';
import { mockContext, mockResponse } from '../helpers.js';

const SHELL = '<!DOCTYPE html><html><head><title>Acme</title></head><body><div id="__next"></div></body></html>';

describe('isHtmlDocument', () => {
  it('should recognise an SPA index shell', () => {
    assert.equal(isHtmlDocument(SHELL), true);
    assert.equal(isHtmlDocument('<html><body>hi</body></html>'), true);
    assert.equal(isHtmlDocument('\n\n  <!doctype html>\n<html>'), true);
  });

  it('should recognise HTML preceded by a comment or BOM', () => {
    assert.equal(isHtmlDocument('<!-- generated -->\n<!doctype html><html></html>'), true);
  });

  it('should not treat JSON, YAML, XML or plain text as a page', () => {
    assert.equal(isHtmlDocument('{"name":"x"}'), false);
    assert.equal(isHtmlDocument('openapi: 3.1.0\ninfo:\n  title: X'), false);
    assert.equal(isHtmlDocument('<?xml version="1.0"?><rsl></rsl>'), false);
    assert.equal(isHtmlDocument('# llms.txt\n\n> A site'), false);
    assert.equal(isHtmlDocument(''), false);
  });

  it('should not be fooled by an <html> mention deep in a JSON document', () => {
    const doc = JSON.stringify({ description: 'x'.repeat(2000), note: '<html> appears late' });
    assert.equal(isHtmlDocument(doc), false);
  });
});

describe('SPA catch-all responses are absence, not corruption', () => {
  it('should report the Agent Card as missing, not malformed', async () => {
    const ctx = mockContext({
      '/.well-known/agent-card.json': mockResponse({ body: SHELL, headers: { 'content-type': 'text/html' } }),
    });
    const result = await agentCard(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.message.includes('not found')));
    assert.ok(!result.findings.some((f) => f.message.includes('Invalid JSON')), 'the site has no card, not a broken one');
  });

  it('should report the MCP server card as missing, not malformed', async () => {
    const ctx = mockContext({
      '/mcp/server-card': mockResponse({ body: SHELL, headers: { 'content-type': 'text/html' } }),
      '/.well-known/mcp/server-card.json': mockResponse({ body: SHELL, headers: { 'content-type': 'text/html' } }),
    });
    const result = await mcpDiscovery(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.message.includes('No MCP server discovery found')));
    assert.ok(!result.findings.some((f) => f.message.includes('Invalid JSON')));
  });

  it('should report the API description as missing, not malformed', async () => {
    const ctx = mockContext({
      '/openapi.json': mockResponse({ body: SHELL, headers: { 'content-type': 'text/html' } }),
    });
    const result = await apiDiscovery(ctx);
    assert.equal(result.score, 0);
    assert.ok(result.findings.some((f) => f.message.includes('No machine-readable API description found')));
  });

  it('should still report a genuinely broken document as broken', async () => {
    const ctx = mockContext({
      '/.well-known/agent-card.json': mockResponse({ body: '{"name": ', headers: { 'content-type': 'application/json' } }),
    });
    const result = await agentCard(ctx);
    assert.equal(result.score, 10);
    assert.ok(result.findings.some((f) => f.message === 'Invalid JSON'));
  });

  it('should keep finding real documents on a site whose other paths are shells', async () => {
    const card = {
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: 'com.example/docs',
      version: '1.0.0',
      description: 'Docs',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', supportedProtocolVersions: ['2026-07-28'] }],
    };
    const ctx = mockContext({
      '/.well-known/mcp/server-card.json': mockResponse({
        body: JSON.stringify(card),
        headers: { 'content-type': 'application/mcp-server-card+json', 'access-control-allow-origin': '*' },
      }),
      '/mcp/server-card': mockResponse({ body: SHELL, headers: { 'content-type': 'text/html' } }),
    });
    const result = await mcpDiscovery(ctx);
    assert.equal(result.score, 100);
  });
});
