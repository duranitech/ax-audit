import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import check, { analyseForms, detectImperative } from '../../dist/checks/webmcp.js';
import { mockContext } from '../helpers.js';

const TOOL_FORM = `<form toolname="searchDocs" tooldescription="Search the documentation">
  <input name="q" toolparamdescription="The search query">
  <input type="hidden" name="csrf" value="x">
  <button type="submit">Go</button>
</form>`;

const page = (body) => `<html><head><title>T</title></head><body>${body}</body></html>`;
const ctx = (body) => mockContext({}, { html: page(body) });

describe('webmcp: form analysis', () => {
  it('should count annotated and unannotated forms', () => {
    const a = analyseForms(page(`${TOOL_FORM}<form><input name="x"></form>`));
    assert.equal(a.total, 2);
    assert.equal(a.annotated, 1);
  });

  it('should flag a toolname with no tooldescription', () => {
    const a = analyseForms(page('<form toolname="searchDocs"><input name="q"></form>'));
    assert.deepEqual(a.missingDescription, ['searchDocs']);
  });

  it('should flag a tooldescription with no toolname', () => {
    const a = analyseForms(page('<form tooldescription="Search"><input name="q"></form>'));
    assert.equal(a.annotated, 1);
    assert.equal(a.missingName, 1, 'a description with no name gives an agent nothing to call');
    assert.deepEqual(a.missingDescription, [], 'the description is present; the name is what is missing');
  });

  it('should reject a tool name that is not an identifier', () => {
    const a = analyseForms(page('<form toolname="search docs" tooldescription="d"><input name="q"></form>'));
    assert.deepEqual(a.invalidNames, ['search docs']);
  });

  it('should count named controls missing a parameter description', () => {
    const a = analyseForms(
      page('<form toolname="t" tooldescription="d"><input name="a"><input name="b" toolparamdescription="B"></form>'),
    );
    assert.deepEqual(a.undescribedParams, [{ tool: 't', missing: 1, total: 2 }]);
  });

  it('should ignore controls that carry no user value', () => {
    const a = analyseForms(page(TOOL_FORM));
    assert.deepEqual(a.undescribedParams, [], 'hidden and submit inputs need no description');
  });

  it('should ignore controls with no name attribute', () => {
    const a = analyseForms(page('<form toolname="t" tooldescription="d"><input placeholder="x"></form>'));
    assert.deepEqual(a.undescribedParams, []);
  });

  it('should cover select and textarea', () => {
    const a = analyseForms(
      page('<form toolname="t" tooldescription="d"><select name="s"></select><textarea name="b"></textarea></form>'),
    );
    assert.deepEqual(a.undescribedParams, [{ tool: 't', missing: 2, total: 2 }]);
  });

  it('should record toolautosubmit', () => {
    const a = analyseForms(page('<form toolname="t" tooldescription="d" toolautosubmit><input name="q" toolparamdescription="Q"></form>'));
    assert.deepEqual(a.autoSubmit, ['t']);
  });

  it('should not confuse two forms with each other', () => {
    const a = analyseForms(
      page(
        '<form toolname="a" tooldescription="A"><input name="x" toolparamdescription="X"></form>' +
          '<form toolname="b" tooldescription="B"><input name="y"></form>',
      ),
    );
    assert.deepEqual(a.undescribedParams, [{ tool: 'b', missing: 1, total: 1 }]);
  });
});

describe('webmcp: imperative detection', () => {
  it('should detect registerTool in a script', () => {
    const d = detectImperative(page('<script>document.modelContext.registerTool({name:"x"})</script>'));
    assert.equal(d.registers, true);
    assert.equal(d.deprecatedNamespace, false);
  });

  it('should detect provideContext', () => {
    assert.equal(detectImperative(page('<script>modelContext.provideContext({})</script>')).registers, true);
  });

  it('should detect the deprecated navigator namespace', () => {
    const d = detectImperative(page('<script>navigator.modelContext.registerTool({})</script>'));
    assert.equal(d.deprecatedNamespace, true);
  });

  it('should not match the words outside a script tag', () => {
    const d = detectImperative(page('<p>Call modelContext.registerTool() to begin.</p>'));
    assert.equal(d.registers, false);
  });
});

describe('webmcp: findings', () => {
  it('should report N/A for a page with no forms and no WebMCP code', async () => {
    const result = await check(ctx('<main><h1>Docs</h1></main>'));
    assert.equal(result.applicable, false);
    assert.ok(result.findings[0].message.includes('nothing here for an agent to invoke'));
  });

  it('should score a well-annotated form 100', async () => {
    const result = await check(ctx(TOOL_FORM));
    assert.equal(result.score, 100);
    assert.ok(result.findings.some((f) => f.message.includes('1/1 form(s) declared as agent tools')));
    assert.ok(result.findings.some((f) => f.message.includes('Every tool parameter carries a description')));
  });

  it('should note unannotated forms as forward-looking, not as a defect', async () => {
    const result = await check(ctx('<form><input name="q"></form>'));
    const finding = result.findings.find((f) => f.message.includes('none declared as agent tools'));
    assert.ok(finding);
    assert.equal(finding.status, 'warn');
    assert.ok(finding.detail.includes('not a standard'));
    assert.equal(result.score, 100, 'an origin-trial feature is never required');
  });

  it('should fail a tool with a description but no name', async () => {
    const result = await check(ctx('<form tooldescription="Search"><input name="q" toolparamdescription="Q"></form>'));
    const finding = result.findings.find((f) => f.message.includes('no tool name'));
    assert.ok(finding);
    assert.equal(finding.status, 'fail');
    assert.equal(result.score, 70);
  });

  it('should fail a tool with a name but no description', async () => {
    const result = await check(ctx('<form toolname="searchDocs"><input name="q" toolparamdescription="Q"></form>'));
    const finding = result.findings.find((f) => f.status === 'fail');
    assert.ok(finding);
    assert.ok(finding.hint.includes('required together'));
    assert.equal(result.score, 70);
  });

  it('should warn about undescribed parameters', async () => {
    const result = await check(ctx('<form toolname="t" tooldescription="d"><input name="q"></form>'));
    const finding = result.findings.find((f) => f.message.includes('parameter(s) have no description'));
    assert.ok(finding);
    assert.ok(finding.hint.includes('search box gets an email address in it'));
    assert.equal(result.score, 85);
  });

  it('should warn about an unusable tool name', async () => {
    const result = await check(ctx('<form toolname="9search" tooldescription="d"><input name="q" toolparamdescription="Q"></form>'));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('not a usable identifier')));
  });

  it('should warn about the deprecated namespace', async () => {
    const result = await check(ctx(`${TOOL_FORM}<script>navigator.modelContext.registerTool({})</script>`));
    assert.equal(result.score, 90);
    assert.ok(result.findings.some((f) => f.message.includes('deprecated navigator.modelContext')));
  });

  it('should note imperative registration and say what it cannot verify', async () => {
    const result = await check(ctx('<script>document.modelContext.registerTool({name:"x"})</script>'));
    const finding = result.findings.find((f) => f.message.includes('Imperative WebMCP registration'));
    assert.ok(finding);
    assert.ok(finding.detail.includes('needs a browser'));
  });

  it('should note toolautosubmit with a caution about consequential actions', async () => {
    const result = await check(
      ctx('<form toolname="t" tooldescription="d" toolautosubmit><input name="q" toolparamdescription="Q"></form>'),
    );
    const finding = result.findings.find((f) => f.message.includes('toolautosubmit'));
    assert.ok(finding.detail.includes('not for anything that charges, sends or deletes'));
  });
});
