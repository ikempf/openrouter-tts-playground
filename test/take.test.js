import test from 'node:test';
import assert from 'node:assert/strict';
import { createTake } from '../js/take.js';

const job = {
  modelId: 'x-ai/grok-voice-tts-1.0',
  voice: 'rex',
  style: '(gravelly)',
  text: 'The old lighthouse.',
  params: { temperature: 0.7 },
  rawOverrides: { provider: { style: 'newscast', styledegree: 1.4 } },
  body: {
    model: 'x-ai/grok-voice-tts-1.0',
    input: '(gravelly)\n\nThe old lighthouse.',
    voice: 'rex',
    response_format: 'mp3',
    temperature: 0.7,
  },
};

test('builds an ok take from a successful result', () => {
  const take = createTake({ job, result: { blob: {} }, id: 'take-1', ts: 1000 });
  assert.deepEqual(take, {
    id: 'take-1',
    model: 'x-ai/grok-voice-tts-1.0',
    voice: 'rex',
    style: '(gravelly)',
    text: 'The old lighthouse.',
    params: { temperature: 0.7 },
    rawOverrides: { provider: { style: 'newscast', styledegree: 1.4 } },
    requestBody: job.body,
    ts: 1000,
    favourite: false,
    status: 'ok',
    error: null,
  });
});

test('builds an error take carrying the error and no audio status', () => {
  const error = { code: 429, message: 'Rate limited.' };
  const take = createTake({ job, result: { error }, id: 'take-2', ts: 2000 });
  assert.equal(take.status, 'error');
  assert.deepEqual(take.error, error);
  // The config is still recorded: a failed take is data when surveying providers.
  assert.equal(take.model, 'x-ai/grok-voice-tts-1.0');
  assert.deepEqual(take.requestBody, job.body);
});

test('a retry records the resent take rather than the job wrapper', () => {
  const original = {
    style: 'as first sent',
    text: 'original script',
    params: { temperature: 0.2 },
    rawOverrides: { provider: { style: 'as first sent' } },
  };
  const retryJob = {
    modelId: 'x-ai/grok-voice-tts-1.0',
    voice: 'rex',
    body: job.body,
    style: 'edited since',
    text: 'edited since',
    params: { temperature: 9 },
    rawOverrides: { provider: { style: 'edited since' } },
    take: original,
  };
  const take = createTake({ job: retryJob, result: { blob: {} }, id: 'take-3', ts: 3000 });
  assert.equal(take.style, 'as first sent');
  assert.equal(take.text, 'original script');
  assert.deepEqual(take.params, { temperature: 0.2 });
  assert.deepEqual(take.rawOverrides, { provider: { style: 'as first sent' } });
});

test('records the overrides, so a take made with them can be reproduced', () => {
  const take = createTake({ job, result: { blob: {} }, id: 'take-5', ts: 5000 });
  assert.deepEqual(take.rawOverrides, { provider: { style: 'newscast', styledegree: 1.4 } });
  // What is recorded must survive the localStorage round trip a clone reads back.
  assert.deepEqual(JSON.parse(JSON.stringify(take)).rawOverrides, take.rawOverrides);
});

test('a job with no overrides records an empty object, never undefined', () => {
  const { rawOverrides, ...withoutOverrides } = job;
  const take = createTake({ job: withoutOverrides, result: { blob: {} }, id: 'i', ts: 1 });
  assert.deepEqual(take.rawOverrides, {});
});

test('an absent voice is recorded as null, not undefined', () => {
  const take = createTake({
    job: { ...job, voice: undefined },
    result: { blob: {} },
    id: 'take-4',
    ts: 4000,
  });
  assert.equal(take.voice, null);
  assert.equal(JSON.parse(JSON.stringify(take)).voice, null);
});

test('copies params so later edits to the caller\'s object cannot rewrite history', () => {
  const params = { temperature: 0.7 };
  const take = createTake({ job: { ...job, params }, result: { blob: {} }, id: 'i', ts: 1 });
  params.temperature = 1.9;
  assert.deepEqual(take.params, { temperature: 0.7 });
});

test('tolerates a job with no params', () => {
  const take = createTake({
    job: { modelId: 'a/b', voice: null, body: {} },
    result: { blob: {} },
    id: 'i',
    ts: 1,
  });
  assert.deepEqual(take.params, {});
});

test('copies the overrides too', () => {
  const rawOverrides = { provider: { style: 'newscast' } };
  const take = createTake({ job: { ...job, rawOverrides }, result: { blob: {} }, id: 'i', ts: 1 });
  delete rawOverrides.provider;
  assert.deepEqual(take.rawOverrides, { provider: { style: 'newscast' } });
});

test('reads no live UI state: it runs at all in an environment with no DOM', () => {
  // These tests pass under bare `node --test`, where there is no document,
  // window or localStorage. Anything the record needs must arrive on the job.
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const first = createTake({ job, result: { blob: {} }, id: 'same', ts: 7 });
  const second = createTake({ job, result: { blob: {} }, id: 'same', ts: 7 });
  assert.deepEqual(first, second);
});
