import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, deepMerge, PARAM_WHITELIST } from '../js/request.js';

const grok = {
  id: 'x-ai/grok-voice-tts-1.0',
  supported_parameters: [
    'max_tokens', 'temperature', 'top_p', 'seed',
    'logprobs', 'top_logprobs', 'response_format',
    'stop', 'frequency_penalty', 'presence_penalty',
  ],
};

test('builds a minimal body', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'The old lighthouse.',
  });
  assert.deepEqual(body, {
    model: 'x-ai/grok-voice-tts-1.0',
    input: 'The old lighthouse.',
    voice: 'rex',
    response_format: 'mp3',
  });
});

test('omits voice when none is given', () => {
  const body = buildRequest({ model: grok, voice: null, text: 'Hello.' });
  assert.equal('voice' in body, false);
});

test('prepends style to the text with a blank line', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'The old lighthouse.',
    style: '(gravelly, unhurried)',
  });
  assert.equal(body.input, '(gravelly, unhurried)\n\nThe old lighthouse.');
});

test('leaves text untouched when style is absent or blank', () => {
  for (const style of [undefined, '', '   ']) {
    const body = buildRequest({ model: grok, voice: 'rex', text: 'Plain.', style });
    assert.equal(body.input, 'Plain.');
  }
});

test('keeps whitelisted params the model supports', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    params: { temperature: 0.7, seed: 42 },
  });
  assert.equal(body.temperature, 0.7);
  assert.equal(body.seed, 42);
});

test('drops LLM params that are not on the whitelist', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    params: { logprobs: true, frequency_penalty: 0.5, stop: ['x'] },
  });
  assert.equal('logprobs' in body, false);
  assert.equal('frequency_penalty' in body, false);
  assert.equal('stop' in body, false);
});

test('drops whitelisted params the model does not support', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    params: { top_k: 40 },
  });
  assert.equal('top_k' in body, false);
});

test('drops params with empty values', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    params: { temperature: '', seed: null, top_p: undefined },
  });
  assert.equal('temperature' in body, false);
  assert.equal('seed' in body, false);
  assert.equal('top_p' in body, false);
});

test('honours responseFormat', () => {
  const body = buildRequest({ model: grok, voice: 'rex', text: 'Hi.', responseFormat: 'pcm' });
  assert.equal(body.response_format, 'pcm');
});

test('raw overrides win over generated fields', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    params: { temperature: 0.7 },
    rawOverrides: { temperature: 1.5, voice: 'leo' },
  });
  assert.equal(body.temperature, 1.5);
  assert.equal(body.voice, 'leo');
});

test('raw overrides can add provider config', () => {
  const body = buildRequest({
    model: grok,
    voice: 'rex',
    text: 'Hi.',
    rawOverrides: { provider: { style: 'newscast', styledegree: 1.4 } },
  });
  assert.deepEqual(body.provider, { style: 'newscast', styledegree: 1.4 });
});

test('deepMerge merges nested objects rather than replacing them', () => {
  const merged = deepMerge({ provider: { style: 'a', keep: 1 } }, { provider: { style: 'b' } });
  assert.deepEqual(merged, { provider: { style: 'b', keep: 1 } });
});

test('deepMerge replaces arrays wholesale', () => {
  assert.deepEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
});

test('the whitelist excludes response_format', () => {
  assert.equal(PARAM_WHITELIST.includes('response_format'), false);
});
