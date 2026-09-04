import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WELL_KNOWN, standingOf, standingNote } from '../dist/checks/well-known.js';
import { CHECK_CATEGORIES } from '../dist/constants.js';

describe('well-known registry', () => {
  it('should give every entry a path, label, standing and spec URL', () => {
    for (const [key, entry] of Object.entries(WELL_KNOWN)) {
      assert.equal(entry.path, key, `${key}: path must match its registry key`);
      assert.ok(entry.label.length > 0, `${key}: missing label`);
      assert.match(entry.specUrl, /^https:\/\//, `${key}: spec URL must be absolute https`);
      assert.ok(
        ['registered', 'convention', 'draft', 'legacy'].includes(entry.standing),
        `${key}: unknown standing "${entry.standing}"`,
      );
    }
  });

  it('should classify the A2A card as registered and the pre-0.3 path as legacy', () => {
    assert.equal(standingOf('/.well-known/agent-card.json'), 'registered');
    assert.equal(standingOf('/.well-known/agent.json'), 'legacy');
  });

  it('should classify unregistered but multi-vendor paths as conventions', () => {
    assert.equal(standingOf('/llms.txt'), 'convention');
    assert.equal(standingOf('/.well-known/ucp'), 'convention');
    assert.equal(standingOf('/openapi.json'), 'convention');
  });

  it('should classify open specs as drafts', () => {
    assert.equal(standingOf('/.well-known/ai-catalog.json'), 'draft');
    assert.equal(standingOf('/.well-known/agent-skills/index.json'), 'draft');
    assert.equal(standingOf('/.well-known/mcp/server-cards.json'), 'draft');
  });

  it('should classify files with no spec or consumer as legacy', () => {
    for (const p of ['/.well-known/nlweb.json', '/.well-known/genai.txt', '/.well-known/ai-plugin.json', '/agents.json']) {
      assert.equal(standingOf(p), 'legacy', `${p} should be legacy`);
    }
  });

  it('should default unknown paths to convention rather than throwing', () => {
    assert.equal(standingOf('/.well-known/something-new.json'), 'convention');
    assert.equal(standingNote('/.well-known/something-new.json'), undefined);
  });

  it('should prefix notes with the standing sentence', () => {
    assert.match(standingNote('/.well-known/agent-card.json'), /^IANA-registered/);
    assert.match(standingNote('/.well-known/ai-catalog.json'), /^Draft specification/);
    assert.match(standingNote('/.well-known/agent.json'), /^Legacy path\./);
    assert.match(standingNote('/llms.txt'), /^Vendor convention, not IANA-registered\./);
  });

  it('should carry a note explaining every non-registered entry', () => {
    for (const [key, entry] of Object.entries(WELL_KNOWN)) {
      if (entry.standing === 'draft' || entry.standing === 'legacy') {
        assert.ok(entry.note, `${key}: ${entry.standing} entries must explain their standing`);
      }
    }
  });
});

describe('check categories', () => {
  it('should map every category to a known value', () => {
    const valid = ['content', 'discovery', 'access', 'policy', 'protocols'];
    for (const [id, category] of Object.entries(CHECK_CATEGORIES)) {
      assert.ok(valid.includes(category), `${id}: unknown category "${category}"`);
    }
  });
});
