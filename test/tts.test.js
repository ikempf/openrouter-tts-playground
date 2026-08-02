import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, SPEECH_URL } from '../js/tts.js';

function audioResponse(bytes = [0xff, 0xf3]) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-123' }),
    blob: async () => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }),
  };
}

function jsonResponse(status, payload, ok = status < 400) {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    blob: async () => {
      throw new Error('must not read a JSON body as a blob');
    },
  };
}

test('returns a blob and generation id for an audio response', async () => {
  const result = await synthesize({
    apiKey: 'sk-or-v1-test',
    body: { model: 'a/b', input: 'Hi.' },
    fetchImpl: async () => audioResponse(),
  });
  assert.ok(result.blob);
  assert.equal(result.blob.type, 'audio/mpeg');
  assert.equal(result.generationId, 'gen-123');
  assert.equal('error' in result, false);
});

test('posts to the speech endpoint with auth and JSON headers', async () => {
  let seenUrl = null;
  let seenInit = null;
  await synthesize({
    apiKey: 'sk-or-v1-test',
    body: { model: 'a/b', input: 'Hi.' },
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return audioResponse();
    },
  });
  assert.equal(seenUrl, SPEECH_URL);
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers.Authorization, 'Bearer sk-or-v1-test');
  assert.equal(seenInit.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seenInit.body), { model: 'a/b', input: 'Hi.' });
});

test('a JSON body with a 200 status is an error, never audio', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () =>
      jsonResponse(200, { error: { message: 'Model does not exist', code: 400 } }, true),
  });
  assert.equal('blob' in result, false);
  assert.match(result.error.message, /Model does not exist/);
});

test('surfaces the API error message for a 400', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () =>
      jsonResponse(400, { error: { message: 'Model openai/x does not exist', code: 400 } }),
  });
  assert.equal(result.error.code, 400);
  assert.match(result.error.message, /does not exist/);
});

test('reports 401, 402, 429 and 502 with their status codes', async () => {
  for (const status of [401, 402, 429, 502]) {
    const result = await synthesize({
      apiKey: 'k',
      body: {},
      fetchImpl: async () => jsonResponse(status, { error: { message: 'nope' } }),
    });
    assert.equal(result.error.code, status);
  }
});

test('falls back to the status when the error body is not JSON', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }),
  });
  assert.equal(result.error.code, 502);
  assert.match(result.error.message, /502/);
});

test('rejects a non-audio, non-JSON success body', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      blob: async () => new Blob(['hello']),
    }),
  });
  assert.equal(result.error.code, 'unexpected-type');
  assert.match(result.error.message, /text\/plain/);
});

test('a thrown fetch becomes a network error rather than an exception', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(result.error.code, 'network');
  assert.match(result.error.message, /Failed to fetch/);
});

test('blob rejection on an audio response resolves to an error, not a thrown rejection', async () => {
  const result = await synthesize({
    apiKey: 'k',
    body: {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-123' }),
      blob: async () => {
        throw new TypeError('Stream aborted');
      },
    }),
  });
  assert.equal(result.error.code, 'network');
  assert.match(result.error.message, /Stream aborted/);
});
