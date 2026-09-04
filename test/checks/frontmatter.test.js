import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../../dist/checks/frontmatter.js';

describe('frontmatter reader', () => {
  it('should parse a flat key/value block and return the body', () => {
    const r = parseFrontmatter('---\nname: deploy\ndescription: How to deploy\n---\n# Deploy\n\nSteps.');
    assert.equal(r.present, true);
    assert.equal(r.frontmatter.name, 'deploy');
    assert.equal(r.frontmatter.description, 'How to deploy');
    assert.equal(r.body, '# Deploy\n\nSteps.');
  });

  it('should report absence rather than an empty result', () => {
    const r = parseFrontmatter('# Just a document\n');
    assert.equal(r.present, false);
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.body, '# Just a document\n');
  });

  it('should require a closing delimiter', () => {
    assert.equal(parseFrontmatter('---\nname: x\n\n# Body').present, false);
  });

  it('should tolerate a BOM and CRLF line endings', () => {
    const r = parseFrontmatter('﻿---\r\nname: deploy\r\n---\r\nBody');
    assert.equal(r.present, true);
    assert.equal(r.frontmatter.name, 'deploy');
    assert.equal(r.body, 'Body');
  });

  it('should unquote double- and single-quoted values', () => {
    const r = parseFrontmatter('---\na: "quoted: value"\nb: \'single\'\nc: "line\\nbreak"\n---\n');
    assert.equal(r.frontmatter.a, 'quoted: value');
    assert.equal(r.frontmatter.b, 'single');
    assert.equal(r.frontmatter.c, 'line\nbreak');
  });

  it('should strip trailing comments from unquoted values only', () => {
    const r = parseFrontmatter('---\na: value # a note\nb: "value # not a note"\n---\n');
    assert.equal(r.frontmatter.a, 'value');
    assert.equal(r.frontmatter.b, 'value # not a note');
  });

  it('should skip comment lines', () => {
    const r = parseFrontmatter('---\n# a comment\nname: x\n---\n');
    assert.equal(Object.keys(r.frontmatter).length, 1);
  });

  it('should lowercase keys', () => {
    assert.equal(parseFrontmatter('---\nName: x\n---\n').frontmatter.name, 'x');
  });

  it('should read an inline flow sequence', () => {
    const r = parseFrontmatter('---\ntags: [alpha, "beta gamma"]\n---\n');
    assert.deepEqual(r.lists.tags, ['alpha', 'beta gamma']);
  });

  it('should read a block sequence', () => {
    const r = parseFrontmatter('---\nallowed-tools:\n  - Read\n  - Bash\nname: x\n---\n');
    assert.deepEqual(r.lists['allowed-tools'], ['Read', 'Bash']);
    assert.equal(r.frontmatter.name, 'x');
  });

  it('should record a nested mapping as skipped rather than mangling it', () => {
    const r = parseFrontmatter('---\nmetadata:\n  author: someone\nname: x\n---\n');
    assert.deepEqual(r.skipped, ['metadata']);
    assert.equal(r.frontmatter.name, 'x', 'a nested value must not swallow the keys after it');
  });

  it('should keep an empty value as an empty string', () => {
    const r = parseFrontmatter('---\nname:\n---\n');
    assert.equal(r.frontmatter.name, '');
  });

  it('should handle an empty frontmatter block', () => {
    const r = parseFrontmatter('---\n---\nBody');
    assert.equal(r.present, true);
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.body, 'Body');
  });

  it('should not treat a horizontal rule mid-document as frontmatter', () => {
    const r = parseFrontmatter('# Title\n\n---\n\nMore text');
    assert.equal(r.present, false);
  });
});
