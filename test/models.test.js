import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, loadCatalog, CATALOG_URL } from '../js/models.js';

const rawGrok = {
  id: 'x-ai/grok-voice-tts-1.0',
  name: 'xAI: Grok Voice TTS 1.0',
  supported_voices: ['eve', 'ara', 'rex', 'sal', 'leo'],
  supported_parameters: ['temperature', 'top_p', 'seed', 'logprobs', 'stop'],
  pricing: { prompt: '0.000015', completion: '0' },
};

const rawFish = {
  id: 'fish-audio/s1',
  name: 'Fish Audio: S1',
  supported_voices: null,
  supported_parameters: [],
  pricing: { prompt: '0.000015', completion: '0' },
};

test('normalizes a model with voices', () => {
  const model = normalizeModel(rawGrok);
  assert.deepEqual(model.voices, ['eve', 'ara', 'rex', 'sal', 'leo']);
  assert.equal(model.freeTextVoice, false);
});

test('null supported_voices becomes free-text mode with an empty list', () => {
  const model = normalizeModel(rawFish);
  assert.deepEqual(model.voices, []);
  assert.equal(model.freeTextVoice, true);
});

test('tunables intersect the whitelist with what the model supports', () => {
  const model = normalizeModel(rawGrok);
  assert.deepEqual(model.tunables, ['temperature', 'top_p', 'seed']);
});

test('a model supporting nothing has no tunables', () => {
  assert.deepEqual(normalizeModel(rawFish).tunables, []);
});

test('falls back to the id when name is missing', () => {
  assert.equal(normalizeModel({ id: 'a/b' }).name, 'a/b');
});

test('missing arrays and pricing do not throw', () => {
  const model = normalizeModel({ id: 'a/b' });
  assert.deepEqual(model.voices, []);
  assert.deepEqual(model.tunables, []);
  assert.equal(model.pricing.prompt, '0');
});

test('loadCatalog fetches the speech-only catalog and sorts by id', async () => {
  let calledWith = null;
  const fakeFetch = async (url) => {
    calledWith = url;
    return { ok: true, status: 200, json: async () => ({ data: [rawGrok, rawFish] }) };
  };
  const models = await loadCatalog(fakeFetch);
  assert.equal(calledWith, CATALOG_URL);
  assert.ok(CATALOG_URL.includes('output_modalities=speech'));
  assert.deepEqual(models.map((m) => m.id), ['fish-audio/s1', 'x-ai/grok-voice-tts-1.0']);
});

test('loadCatalog throws a useful message on a failed fetch', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => loadCatalog(fakeFetch), /503/);
});
