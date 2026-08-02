import test from 'node:test';
import assert from 'node:assert/strict';
import { PHRASES, nextPhrase } from '../js/phrases.js';

test('the library is not empty', () => {
  assert.ok(PHRASES.length > 0);
});

test('every phrase has a non-empty name and text', () => {
  for (const phrase of PHRASES) {
    assert.equal(typeof phrase.name, 'string');
    assert.ok(phrase.name.trim().length > 0, `empty name: ${JSON.stringify(phrase)}`);
    assert.equal(typeof phrase.text, 'string');
    assert.ok(phrase.text.trim().length > 0, `empty text for ${phrase.name}`);
  }
});

test('phrase names are unique, so the label always identifies one entry', () => {
  const names = PHRASES.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('nextPhrase advances by one', () => {
  const result = nextPhrase(0);
  assert.equal(result.index, 1);
  assert.equal(result.name, PHRASES[1].name);
  assert.equal(result.text, PHRASES[1].text);
});

test('nextPhrase wraps at the end', () => {
  assert.equal(nextPhrase(PHRASES.length - 1).index, 0);
});

test('nextPhrase starts at the first phrase when there is no current index', () => {
  for (const absent of [undefined, null, NaN, 'two']) {
    assert.equal(nextPhrase(absent).index, 0);
  }
});

test('nextPhrase tolerates an out-of-range index from stale storage', () => {
  for (const stale of [99, -5, PHRASES.length]) {
    const result = nextPhrase(stale);
    assert.ok(Number.isInteger(result.index));
    assert.ok(result.index >= 0 && result.index < PHRASES.length);
    assert.equal(result.name, PHRASES[result.index].name);
  }
});

test('nextPhrase does not expose the library entry for mutation', () => {
  const result = nextPhrase(0);
  result.text = 'clobbered';
  assert.notEqual(PHRASES[1].text, 'clobbered');
});

test('the library covers a spread of delivery styles, not one register', () => {
  // The point of the set is auditioning voices, so a library that was all
  // calm narration would defeat it. Guard the spread rather than the wording.
  assert.ok(PHRASES.length >= 6);
  const joined = PHRASES.map((p) => p.text).join(' ');
  assert.match(joined, /\?/, 'no phrase exercises question intonation');
  assert.match(joined, /!/, 'no phrase exercises exclamation');
  assert.match(joined, /\d/, 'no phrase exercises spoken numbers');
});
