import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CRAWLERS,
  ALL_AI_CRAWLERS,
  CORE_AI_CRAWLERS,
  CRAWLER_META,
  LEGACY_AI_CRAWLERS,
  PROBEABLE_CORE_CRAWLERS,
  crawlerInfo,
  crawlerPurpose,
  legacyCrawlerNote,
} from '../dist/constants.js';

const lower = (list) => list.map((t) => t.toLowerCase());

describe('crawler catalogue: integrity', () => {
  it('should list every token exactly once across purpose buckets', () => {
    const seen = new Map();
    for (const [purpose, tokens] of Object.entries(AI_CRAWLERS)) {
      for (const token of tokens) {
        const key = token.toLowerCase();
        assert.ok(!seen.has(key), `${token} appears in both ${seen.get(key)} and ${purpose}`);
        seen.set(key, purpose);
      }
    }
    assert.equal(seen.size, ALL_AI_CRAWLERS.length);
  });

  it('should keep legacy tokens out of the active catalogue', () => {
    for (const token of Object.keys(LEGACY_AI_CRAWLERS)) {
      assert.ok(
        !lower(ALL_AI_CRAWLERS).includes(token.toLowerCase()),
        `${token} is retired and must not be recommended`,
      );
    }
  });

  it('should explain every legacy token', () => {
    for (const [token, note] of Object.entries(LEGACY_AI_CRAWLERS)) {
      assert.ok(note.length > 20, `${token}: the note must say why the token is inert`);
    }
  });

  it('should describe every metadata entry with an impact sentence and a vendor doc', () => {
    for (const [token, info] of Object.entries(CRAWLER_META)) {
      assert.ok(info.impact.length > 20, `${token}: impact must explain what blocking costs`);
      assert.match(info.docUrl, /^https:\/\//, `${token}: docUrl must be absolute https`);
      assert.ok(
        ['training', 'search', 'user-fetch', 'agent'].includes(info.purpose),
        `${token}: unknown purpose "${info.purpose}"`,
      );
      assert.ok([true, false, 'partial'].includes(info.honorsRobots), `${token}: bad honorsRobots`);
      if (info.ipListUrl) assert.match(info.ipListUrl, /^https:\/\//, `${token}: bad ipListUrl`);
    }
  });

  it('should agree between CRAWLER_META purpose and the bucket a token sits in', () => {
    for (const [token, info] of Object.entries(CRAWLER_META)) {
      assert.equal(crawlerPurpose(token), info.purpose, `${token}: bucket and metadata disagree on purpose`);
    }
  });

  it('should only carry metadata for tokens in the active catalogue', () => {
    for (const token of Object.keys(CRAWLER_META)) {
      assert.ok(lower(ALL_AI_CRAWLERS).includes(token.toLowerCase()), `${token} has metadata but is not catalogued`);
    }
  });
});

describe('crawler catalogue: core sets', () => {
  it('should draw every core crawler from the catalogue', () => {
    for (const token of CORE_AI_CRAWLERS) {
      assert.ok(lower(ALL_AI_CRAWLERS).includes(token.toLowerCase()), `${token} is core but not catalogued`);
    }
  });

  it('should document every core crawler', () => {
    for (const token of CORE_AI_CRAWLERS) {
      assert.ok(crawlerInfo(token), `${token} is core and must carry metadata explaining the block cost`);
    }
  });

  it('should cover training, search and user-fetch in the core set', () => {
    const purposes = new Set(CORE_AI_CRAWLERS.map(crawlerPurpose));
    for (const p of ['training', 'search', 'user-fetch']) {
      assert.ok(purposes.has(p), `the core set must include at least one ${p} client`);
    }
  });

  it('should exclude robots.txt-only control tokens from the probeable set', () => {
    assert.ok(CORE_AI_CRAWLERS.includes('Google-Extended'));
    assert.ok(!PROBEABLE_CORE_CRAWLERS.includes('Google-Extended'));
    assert.ok(!PROBEABLE_CORE_CRAWLERS.includes('Applebot-Extended'));
    assert.equal(PROBEABLE_CORE_CRAWLERS.length, CORE_AI_CRAWLERS.length - 2);
  });

  it('should mark exactly the two opt-out tokens as tokenOnly', () => {
    const tokenOnly = Object.entries(CRAWLER_META)
      .filter(([, info]) => info.tokenOnly)
      .map(([token]) => token)
      .sort();
    assert.deepEqual(tokenOnly, ['Applebot-Extended', 'Google-Extended']);
  });
});

describe('crawler catalogue: 2026 corrections', () => {
  it('should no longer treat user-triggered fetchers as training crawlers', () => {
    for (const token of ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'MistralAI-User', 'meta-externalfetcher']) {
      assert.equal(crawlerPurpose(token), 'user-fetch', `${token} fetches on a user's behalf, it does not train`);
    }
  });

  it('should classify bingbot as a search crawler', () => {
    assert.equal(crawlerPurpose('bingbot'), 'search');
  });

  it('should include the crawlers that gained traffic share in 2026', () => {
    for (const token of ['meta-webindexer', 'Amzn-SearchBot', 'Amzn-User', 'MistralAI-Index', 'MistralAI-Training']) {
      assert.ok(crawlerPurpose(token), `${token} is missing from the catalogue`);
    }
  });

  it('should reject tokens that were never real user agents', () => {
    for (const token of ['Gemini', 'GeminiBot', 'DeepSeek-AI']) {
      assert.ok(legacyCrawlerNote(token), `${token} must be recorded as never-real`);
      assert.equal(crawlerPurpose(token), undefined);
    }
  });

  it('should reject tokens whose products were discontinued', () => {
    for (const token of ['NeevaBot', 'GoogleAgent-Mariner', 'Operator', 'Google-NotebookLM']) {
      assert.ok(legacyCrawlerNote(token), `${token} must be recorded as retired`);
    }
  });

  it('should carry the Gemini Notebook rename', () => {
    assert.equal(crawlerPurpose('Google-GeminiNotebook'), 'user-fetch');
    assert.match(legacyCrawlerNote('Google-NotebookLM'), /Google-GeminiNotebook/);
  });

  it('should drop Cohere, which operates no crawlers', () => {
    for (const token of ['Cohere-AI', 'cohere-training-data-crawler']) {
      assert.match(legacyCrawlerNote(token), /no web crawlers/);
    }
  });

  it('should record which user-triggered fetchers ignore robots.txt', () => {
    assert.equal(crawlerInfo('Perplexity-User').honorsRobots, false);
    assert.equal(crawlerInfo('ChatGPT-User').honorsRobots, 'partial');
    assert.equal(crawlerInfo('Claude-User').honorsRobots, true, 'Anthropic documents this exception');
    assert.equal(crawlerInfo('Google-Agent').honorsRobots, false);
  });

  it('should explain that Google-Extended does not govern AI Overviews', () => {
    assert.match(crawlerInfo('Google-Extended').impact, /does NOT remove your site from AI Overviews/);
  });

  it('should say what blocking a search crawler costs, in its own words', () => {
    assert.match(crawlerInfo('OAI-SearchBot').impact, /ChatGPT search/);
    assert.match(crawlerInfo('Claude-SearchBot').impact, /Claude cites/);
    assert.match(crawlerInfo('PerplexityBot').impact, /Perplexity answers/);
  });

  it('should record the vendors that sign requests with Web Bot Auth', () => {
    for (const token of ['Google-Agent', 'ExaSearchBot', 'YouBot']) {
      assert.equal(crawlerInfo(token).signsRequests, true, `${token} signs its requests`);
    }
  });

  it('should look tokens up case-insensitively', () => {
    assert.equal(crawlerInfo('gptbot').vendor, 'OpenAI');
    assert.equal(crawlerPurpose('BINGBOT'), 'search');
    assert.ok(legacyCrawlerNote('claude-web'));
  });
});

describe('crawler catalogue: 4.0 scoring', () => {
  it('should score against the full current core set', () => {
    assert.equal(CORE_AI_CRAWLERS.length, 12, 'the 3.x eight-token freeze is gone');
  });

  it('should include the crawlers that gained share in 2026', () => {
    for (const token of ['Meta-ExternalAgent', 'Applebot-Extended', 'Amazonbot', 'Bytespider']) {
      assert.ok(CORE_AI_CRAWLERS.includes(token), `${token} belongs in the scored core set`);
    }
  });
});

describe('4.0 weights', () => {
  it('should sum to exactly 100', async () => {
    const { CHECK_WEIGHTS } = await import('../dist/constants.js');
    const total = Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(total, 100);
  });

  it('should keep weights in one place', async () => {
    const { checks } = await import('../dist/checks/index.js');
    const declaring = checks.filter((c) => c.meta.weight !== undefined).map((c) => c.meta.id);
    assert.deepEqual(declaring, [], 'a check declaring its own weight can drift from the central map');
  });

  it('should give every registered check a weight entry, and no orphans', async () => {
    const { CHECK_WEIGHTS } = await import('../dist/constants.js');
    const { checks } = await import('../dist/checks/index.js');
    const ids = checks.map((c) => c.meta.id).sort();
    assert.deepEqual(Object.keys(CHECK_WEIGHTS).sort(), ids);
  });

  it('should give every registered check a category', async () => {
    const { CHECK_CATEGORIES } = await import('../dist/constants.js');
    const { checks } = await import('../dist/checks/index.js');
    for (const c of checks) {
      const category = c.meta.category ?? CHECK_CATEGORIES[c.meta.id];
      assert.ok(category, `${c.meta.id} has no category`);
    }
  });

  it('should weight content above every other area', async () => {
    const { CHECK_WEIGHTS, CHECK_CATEGORIES } = await import('../dist/constants.js');
    const { checks } = await import('../dist/checks/index.js');
    const byCategory = {};
    for (const c of checks) {
      const category = c.meta.category ?? CHECK_CATEGORIES[c.meta.id];
      byCategory[category] = (byCategory[category] ?? 0) + CHECK_WEIGHTS[c.meta.id];
    }
    // A page with nothing in its HTML is the failure that breaks the most
    // agents, so content leads.
    const max = Math.max(...Object.values(byCategory));
    assert.equal(byCategory.content, max);
    assert.ok(CHECK_WEIGHTS['html-rendering'] >= 10, 'the single highest-impact check');
  });

  it('should score llms.txt below html-rendering, per the adoption evidence', async () => {
    const { CHECK_WEIGHTS } = await import('../dist/constants.js');
    assert.ok(
      CHECK_WEIGHTS['llms-txt'] < CHECK_WEIGHTS['html-rendering'],
      'most published llms.txt files are never fetched; a page with no content is always fatal',
    );
  });

  it('should keep every draft-specification check at zero', async () => {
    const { CHECK_WEIGHTS } = await import('../dist/constants.js');
    for (const id of ['ai-catalog', 'webmcp', 'commerce-discovery']) {
      assert.equal(CHECK_WEIGHTS[id], 0, `${id} rests on a draft that may be renamed`);
    }
  });
});
