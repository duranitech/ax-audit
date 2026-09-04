import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDictionary, dictValue } from '../../dist/checks/structured-fields.js';

describe('structured-fields dictionary parser', () => {
  it('should parse the AIPREF Content-Usage shape', () => {
    const d = parseDictionary('train-ai=n, search=y');
    assert.equal(d.malformed.length, 0);
    assert.deepEqual(
      d.members.map((m) => [m.key, m.value]),
      [
        ['train-ai', 'n'],
        ['search', 'y'],
      ],
    );
  });

  it('should treat a bare key as boolean true', () => {
    const d = parseDictionary('streaming, search=y');
    assert.equal(d.members[0].key, 'streaming');
    assert.equal(d.members[0].value, '?1');
  });

  it('should capture parameters without losing the member', () => {
    const d = parseDictionary('train-ai=n;allow=n;note="see policy"');
    assert.equal(d.members.length, 1);
    assert.equal(d.members[0].value, 'n');
    assert.equal(d.members[0].params.allow, 'n');
    assert.equal(d.members[0].params.note, 'see policy');
  });

  it('should not split on commas inside quoted strings', () => {
    const d = parseDictionary('a="x, y", b=z');
    assert.equal(d.members.length, 2);
    assert.equal(d.members[0].value, 'x, y');
    assert.equal(d.members[1].value, 'z');
  });

  it('should unescape quoted strings', () => {
    const d = parseDictionary('note="a \\"quoted\\" word"');
    assert.equal(d.members[0].value, 'a "quoted" word');
  });

  it('should lowercase keys', () => {
    const d = parseDictionary('Train-AI=n');
    assert.equal(d.members[0].key, 'train-ai');
  });

  it('should report malformed segments instead of dropping them silently', () => {
    const d = parseDictionary('train-ai=n, 9bad=y, search=y');
    assert.deepEqual(
      d.members.map((m) => m.key),
      ['train-ai', 'search'],
    );
    assert.deepEqual(d.malformed, ['9bad=y']);
  });

  it('should treat an empty value as malformed', () => {
    const d = parseDictionary('train-ai=');
    assert.equal(d.members.length, 0);
    assert.deepEqual(d.malformed, ['train-ai=']);
  });

  it('should tolerate empty input and stray separators', () => {
    assert.deepEqual(parseDictionary('').members, []);
    assert.deepEqual(parseDictionary('   ').members, []);
    const d = parseDictionary('a=1, , b=2');
    assert.equal(d.members.length, 2);
    assert.equal(d.malformed.length, 0);
  });

  it('should reject a malformed parameter key without discarding other members', () => {
    const d = parseDictionary('a=1;9bad, b=2');
    assert.deepEqual(
      d.members.map((m) => m.key),
      ['b'],
    );
    assert.deepEqual(d.malformed, ['a=1;9bad']);
  });

  it('should look up values by key case-insensitively', () => {
    const d = parseDictionary('train-ai=n');
    assert.equal(dictValue(d, 'TRAIN-AI'), 'n');
    assert.equal(dictValue(d, 'search'), null);
  });

  it('should accept keys starting with an asterisk (RFC 9651)', () => {
    const d = parseDictionary('*ext=1');
    assert.equal(d.members[0].key, '*ext');
  });
});
