import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, nextPreset, resolvePhrase } from '../js/presets.js';
import { PHRASES } from '../js/phrases.js';

test('the preset library is not empty', () => {
  assert.ok(PRESETS.length > 0);
});

test('every preset has a non-empty name and style', () => {
  for (const preset of PRESETS) {
    assert.ok(preset.name?.trim(), `empty name: ${JSON.stringify(preset)}`);
    assert.ok(preset.style?.trim(), `empty style for ${preset.name}`);
  }
});

test('preset names are unique', () => {
  const names = PRESETS.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('every preset points at a phrase that exists', () => {
  // The seam where drift lands silently: rename a phrase and the preset would
  // otherwise set an empty textarea with no error anywhere.
  const known = new Set(PHRASES.map((p) => p.name));
  for (const preset of PRESETS) {
    assert.ok(known.has(preset.phrase), `${preset.name} points at missing phrase "${preset.phrase}"`);
  }
});

test('every preset sets temperature and top_p within the ranges the API accepts', () => {
  for (const { name, params } of PRESETS) {
    assert.ok(params.temperature >= 0 && params.temperature <= 2, `${name} temperature`);
    assert.ok(params.top_p > 0 && params.top_p <= 1, `${name} top_p`);
  }
});

test('resolvePhrase finds a phrase by name', () => {
  const resolved = resolvePhrase(PHRASES[2].name);
  assert.equal(resolved.phraseIndex, 2);
  assert.equal(resolved.phraseName, PHRASES[2].name);
  assert.equal(resolved.text, PHRASES[2].text);
});

test('resolvePhrase reports an unknown name rather than inventing text', () => {
  const resolved = resolvePhrase('No such phrase');
  assert.equal(resolved.phraseIndex, null);
  assert.equal('text' in resolved, false);
});

test('nextPreset advances by one', () => {
  const result = nextPreset(0);
  assert.equal(result.index, 1);
  assert.equal(result.name, PRESETS[1].name);
  assert.equal(result.style, PRESETS[1].style);
});

test('nextPreset wraps at the end', () => {
  assert.equal(nextPreset(PRESETS.length - 1).index, 0);
});

test('nextPreset starts at the first preset when there is no current index', () => {
  for (const absent of [undefined, null, NaN, 'two']) {
    assert.equal(nextPreset(absent).index, 0);
  }
});

test('nextPreset tolerates an out-of-range index from stale storage', () => {
  for (const stale of [99, -5, PRESETS.length]) {
    const result = nextPreset(stale);
    assert.ok(result.index >= 0 && result.index < PRESETS.length);
    assert.equal(result.name, PRESETS[result.index].name);
  }
});

test('nextPreset carries the resolved phrase so the text cycler resumes from it', () => {
  const result = nextPreset(-1);
  const preset = PRESETS[0];
  assert.equal(result.phraseName, preset.phrase);
  assert.equal(PHRASES[result.phraseIndex].name, preset.phrase);
  assert.equal(result.text, PHRASES[result.phraseIndex].text);
});

test('nextPreset does not expose the library for mutation', () => {
  const result = nextPreset(0);
  result.params.temperature = 99;
  result.style = 'clobbered';
  assert.notEqual(PRESETS[1].params.temperature, 99);
  assert.notEqual(PRESETS[1].style, 'clobbered');
});

test('the presets span a spread of directions, not one setting', () => {
  assert.ok(PRESETS.length >= 4);
  const temps = new Set(PRESETS.map((p) => p.params.temperature));
  assert.ok(temps.size >= 3, 'presets barely vary temperature');
  const phrases = new Set(PRESETS.map((p) => p.phrase));
  assert.equal(phrases.size, PRESETS.length, 'two presets reuse the same phrase');
});
