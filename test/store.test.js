import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryAudioStore } from '../js/store.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const take = (id, extra = {}) => ({
  id,
  model: 'x-ai/grok-voice-tts-1.0',
  voice: 'rex',
  style: '',
  text: 'Hi.',
  params: { temperature: 0.7 },
  requestBody: { model: 'x-ai/grok-voice-tts-1.0', input: 'Hi.', voice: 'rex' },
  ts: 1000,
  favourite: false,
  status: 'ok',
  error: null,
  ...extra,
});

test('round-trips the api key', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  assert.equal(store.getApiKey(), '');
  store.setApiKey('sk-or-v1-abc');
  assert.equal(store.getApiKey(), 'sk-or-v1-abc');
});

test('round-trips form state', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  assert.deepEqual(store.getForm(), {});
  store.setForm({ text: 'Hello', style: 'warm' });
  assert.deepEqual(store.getForm(), { text: 'Hello', style: 'warm' });
});

test('round-trips the catalog', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  assert.equal(store.getCatalog(), null);
  store.setCatalog([{ id: 'a/b' }]);
  assert.deepEqual(store.getCatalog(), [{ id: 'a/b' }]);
});

test('corrupt stored JSON falls back to the default instead of throwing', () => {
  const storage = fakeStorage({ 'or_tts.form': '{not json', 'or_tts.takes': 'oops' });
  const store = createStore({ storage, audio: createMemoryAudioStore() });
  assert.deepEqual(store.getForm(), {});
  assert.deepEqual(store.listTakes(), []);
});

test('takes list newest first', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  store.addTake(take('a', { ts: 1 }));
  store.addTake(take('b', { ts: 2 }));
  assert.deepEqual(store.listTakes().map((t) => t.id), ['b', 'a']);
});

test('updateTake patches one take and leaves the rest alone', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  store.addTake(take('a'));
  store.addTake(take('b'));
  store.updateTake('a', { favourite: true });
  const byId = Object.fromEntries(store.listTakes().map((t) => [t.id, t]));
  assert.equal(byId.a.favourite, true);
  assert.equal(byId.b.favourite, false);
});

test('updateTake on an unknown id is a no-op', () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  store.addTake(take('a'));
  store.updateTake('missing', { favourite: true });
  assert.equal(store.listTakes().length, 1);
});

test('removeTake drops the record and its audio', async () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  store.addTake(take('a'));
  await store.putAudio('a', new Blob(['xx']));
  await store.removeTake('a');
  assert.deepEqual(store.listTakes(), []);
  assert.equal(await store.getAudio('a'), undefined);
});

test('audio round-trips through the backend', async () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  await store.putAudio('a', new Blob(['hello'], { type: 'audio/mpeg' }));
  const blob = await store.getAudio('a');
  assert.equal(blob.type, 'audio/mpeg');
  assert.equal(await blob.text(), 'hello');
});

test('audioUsage reports total stored bytes', async () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  await store.putAudio('a', new Blob(['12345']));
  await store.putAudio('b', new Blob(['123']));
  assert.equal(await store.audioUsage(), 8);
});

test('clearAudio empties the blobs but keeps the take records', async () => {
  const store = createStore({ storage: fakeStorage(), audio: createMemoryAudioStore() });
  store.addTake(take('a'));
  await store.putAudio('a', new Blob(['x']));
  await store.clearAudio();
  assert.equal(await store.audioUsage(), 0);
  assert.equal(store.listTakes().length, 1);
});

test('a quota failure on putAudio is reported, not thrown', async () => {
  const failing = {
    put: async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    },
    get: async () => undefined,
    remove: async () => {},
    clear: async () => {},
    usage: async () => 0,
  };
  const store = createStore({ storage: fakeStorage(), audio: failing });
  const result = await store.putAudio('a', new Blob(['x']));
  assert.equal(result.ok, false);
  assert.match(result.message, /quota/i);
});
