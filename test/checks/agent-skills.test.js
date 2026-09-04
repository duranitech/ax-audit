import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check from '../../dist/checks/agent-skills.js';
import { mockContext, mockResponse } from '../helpers.js';

const DIGEST = 'sha256:' + 'a'.repeat(64);
const INDEX_PATH = '/.well-known/agent-skills/index.json';
const JSON_HEADERS = { 'content-type': 'application/json' };
const MD_HEADERS = { 'content-type': 'text/markdown' };

const SKILL_MD = (name = 'deploy', description = 'Deploy this project to production.') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps here.\n`;

const INDEX = {
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'deploy',
      description: 'Deploy this project to production.',
      type: 'skill-md',
      url: '/.well-known/agent-skills/deploy/SKILL.md',
      digest: DIGEST,
    },
  ],
};

const DOCS_HTML = '<html><body><a href="/docs/getting-started">Docs</a></body></html>';

function ctx({ index = INDEX, skill = SKILL_MD(), routes = {}, html = DOCS_HTML, indexPath = INDEX_PATH } = {}) {
  return mockContext(
    {
      [indexPath]: mockResponse({ body: JSON.stringify(index), headers: JSON_HEADERS }),
      '/.well-known/agent-skills/deploy/SKILL.md': mockResponse({ body: skill, headers: MD_HEADERS }),
      ...routes,
    },
    { html },
  );
}

describe('agent-skills: applicability', () => {
  it('should report N/A for a site with no developer surface', async () => {
    const result = await check(mockContext({}, { html: '<html><body><h1>A restaurant</h1></body></html>' }));
    assert.equal(result.applicable, false, 'a site with no procedures to teach has nothing to publish');
    assert.equal(result.findings[0].status, 'pass');
    assert.ok(result.findings[0].message.includes('do not apply to this site'));
  });

  it('should apply when the site links to documentation', async () => {
    const result = await check(mockContext({}, { html: DOCS_HTML }));
    assert.notEqual(result.applicable, false);
    assert.equal(result.score, 0);
    assert.ok(result.findings[0].message.includes('No Agent Skills published'));
  });

  it('should apply when the site publishes llms.txt', async () => {
    const c = mockContext({ '/llms.txt': mockResponse({ body: '# Site\n\n> A site' }) }, { html: '<html></html>' });
    const result = await check(c);
    assert.notEqual(result.applicable, false);
  });

  it('should apply when the site publishes an OpenAPI description', async () => {
    const c = mockContext({ '/openapi.json': mockResponse({ body: '{"openapi":"3.1.0"}' }) }, { html: '<html></html>' });
    assert.notEqual((await check(c)).applicable, false);
  });
});

describe('agent-skills: index validation', () => {
  it('should score a complete index 100', async () => {
    const result = await check(ctx());
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('1 skill(s) listed')));
    assert.ok(result.findings.some((f) => f.message.includes('install cleanly')));
  });

  it('should accept the shorter Mintlify path', async () => {
    const result = await check(ctx({ indexPath: '/.well-known/skills/index.json' }));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('/.well-known/skills/index.json')));
  });

  it('should fail an unparseable index', async () => {
    const result = await check(ctx({ index: undefined, routes: { [INDEX_PATH]: mockResponse({ body: '{', headers: JSON_HEADERS }) } }));
    assert.equal(result.score, 10);
  });

  it('should warn about a missing $schema', async () => {
    const result = await check(ctx({ index: { skills: INDEX.skills } }));
    assert.equal(result.score, 95);
  });

  it('should warn about an empty index', async () => {
    const result = await check(ctx({ index: { ...INDEX, skills: [] } }));
    assert.equal(result.score, 70);
    assert.ok(result.findings.some((f) => f.message.includes('lists no skills')));
  });

  it('should reject a name outside the allowed format', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], name: 'Deploy Now' }] };
    const result = await check(ctx({ index }));
    assert.ok(result.findings.some((f) => f.message.includes('outside the allowed format')));
  });

  it('should fail a skill with no description', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], description: '' }] };
    const result = await check(ctx({ index }));
    const finding = result.findings.find((f) => f.status === 'fail' && f.message.includes('no description'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('decide whether to install'));
  });

  it('should warn about an over-long description', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], description: 'x'.repeat(1200) }] };
    const result = await check(ctx({ index }));
    assert.ok(result.findings.some((f) => f.message.includes('exceed 1024 characters')));
  });

  it('should reject an unrecognised type', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], type: 'zip' }] };
    const result = await check(ctx({ index }));
    assert.ok(result.findings.some((f) => f.message.includes('unrecognised type')));
  });

  it('should reject a malformed digest', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], digest: 'sha256:short' }] };
    const result = await check(ctx({ index }));
    assert.ok(result.findings.some((f) => f.message.includes('digest(s) are malformed')));
  });

  it('should nudge when no skill declares a digest', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], digest: undefined }] };
    const result = await check(ctx({ index }));
    const finding = result.findings.find((f) => f.message.includes('No skill declares a content digest'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('verify it installed the skill you published'));
  });
});

describe('agent-skills: skill documents', () => {
  it('should fail when a listed skill 404s', async () => {
    const result = await check(
      ctx({ routes: { '/.well-known/agent-skills/deploy/SKILL.md': mockResponse({ status: 404, ok: false, body: '' }) } }),
    );
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding.detail.includes('404'));
    assert.ok(finding.hint.includes('trusted before it is fetched'));
  });

  it('should fail a SKILL.md with no frontmatter', async () => {
    const result = await check(ctx({ skill: '# Deploy\n\nJust prose.' }));
    assert.ok(result.findings.some((f) => f.detail?.includes('no YAML frontmatter')));
  });

  it('should catch a frontmatter name that disagrees with the index', async () => {
    const result = await check(ctx({ skill: SKILL_MD('deployment') }));
    const finding = result.findings.find((f) => f.detail?.includes('disagrees with the index'));
    assert.ok(finding);
  });

  it('should catch a SKILL.md with no description', async () => {
    const result = await check(ctx({ skill: '---\nname: deploy\n---\n\n# Deploy\n' }));
    assert.ok(result.findings.some((f) => f.detail?.includes('frontmatter has no description')));
  });

  it('should warn about a very long skill', async () => {
    const long = `---\nname: deploy\ndescription: Deploy.\n---\n${'line\n'.repeat(600)}`;
    const result = await check(ctx({ skill: long }));
    assert.ok(result.findings.some((f) => f.message.includes('lines long')));
  });

  it('should not parse an archive entry as Markdown', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], type: 'archive', url: '/skills/deploy.tar.gz' }] };
    const result = await check(
      ctx({ index, routes: { '/skills/deploy.tar.gz': mockResponse({ body: 'binary-ish', headers: { 'content-type': 'application/gzip' } }) } }),
    );
    assert.equal(result.score, 100);
  });

  it('should warn when no entry carries a url', async () => {
    const index = { ...INDEX, skills: [{ ...INDEX.skills[0], url: undefined }] };
    const result = await check(ctx({ index }));
    assert.equal(result.score, 85);
    assert.ok(result.findings.some((f) => f.message.includes('No skill entry carries a url')));
  });
});

describe('agent-skills: single skill without an index', () => {
  it('should accept /skill.md but say it is undiscoverable', async () => {
    const c = mockContext({ '/skill.md': mockResponse({ body: SKILL_MD(), headers: MD_HEADERS }) }, { html: DOCS_HTML });
    const result = await check(c);
    assert.equal(result.score, 80);
    assert.ok(result.findings.some((f) => f.message.includes('not listed in a discovery index')));
    assert.ok(result.findings.some((f) => f.message.includes('declares a description')));
  });

  it('should fail a bare skill with no frontmatter', async () => {
    const c = mockContext({ '/skill.md': mockResponse({ body: '# Deploy', headers: MD_HEADERS }) }, { html: DOCS_HTML });
    const result = await check(c);
    assert.equal(result.score, 50);
    assert.ok(result.findings.some((f) => f.status === 'fail' && f.message.includes('no YAML frontmatter')));
  });
});
