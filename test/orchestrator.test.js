import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { batchAudit } from '../dist/orchestrator.js';

/**
 * Integration tests for batchAudit ordering and concurrency, against a local
 * server that tracks how many requests overlap in time.
 */
describe('batchAudit', () => {
  let server;
  let baseUrl;
  let inFlight;
  let maxInFlight;

  before(async () => {
    inFlight = 0;
    maxInFlight = 0;
    server = createServer(async (req, res) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><main>${req.url}</main></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function urls(n) {
    return Array.from({ length: n }, (_, i) => `${baseUrl}/site-${i}`);
  }

  it('should audit every URL and preserve input order', async () => {
    const input = urls(4);
    const batch = await batchAudit(input, { timeout: 5000 });
    assert.equal(batch.reports.length, 4);
    assert.deepEqual(
      batch.reports.map((r) => r.url),
      input,
    );
    assert.equal(batch.summary.total, 4);
  });

  it('should run sequentially by default (concurrency 1)', async () => {
    maxInFlight = 0;
    await batchAudit(urls(4), { timeout: 5000, checks: ['html-rendering'] });
    assert.equal(maxInFlight, 1);
  });

  it('should overlap requests when concurrency > 1', async () => {
    maxInFlight = 0;
    await batchAudit(urls(6), { timeout: 5000, concurrency: 3, checks: ['html-rendering'] });
    assert.ok(maxInFlight > 1, `expected parallelism, saw maxInFlight=${maxInFlight}`);
    assert.ok(maxInFlight <= 3, `concurrency cap exceeded: ${maxInFlight}`);
  });

  it('should preserve order even with concurrency and varied response timing', async () => {
    const input = urls(5);
    const batch = await batchAudit(input, { timeout: 5000, concurrency: 5, checks: ['html-rendering'] });
    assert.deepEqual(
      batch.reports.map((r) => r.url),
      input,
    );
  });

  it('should treat concurrency < 1 as sequential', async () => {
    maxInFlight = 0;
    await batchAudit(urls(3), { timeout: 5000, concurrency: 0, checks: ['html-rendering'] });
    assert.equal(maxInFlight, 1);
  });

  it('should compute summary aggregates', async () => {
    const batch = await batchAudit(urls(3), { timeout: 5000, concurrency: 3 });
    assert.equal(batch.summary.total, 3);
    assert.equal(batch.summary.passed + batch.summary.failed, 3);
    assert.ok(typeof batch.summary.averageScore === 'number');
    assert.ok(batch.summary.grade.label);
  });
});
