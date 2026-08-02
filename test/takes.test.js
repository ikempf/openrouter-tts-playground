import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTakeLabel, formatBytes } from '../js/takes.js';

test('labels model, voice and params', () => {
  const label = formatTakeLabel({
    model: 'x-ai/grok-voice-tts-1.0',
    voice: 'rex',
    params: { temperature: 0.7 },
  });
  assert.equal(label, 'x-ai/grok-voice-tts-1.0 · rex · temperature 0.7');
});

test('says default when no voice was sent', () => {
  const label = formatTakeLabel({ model: 'fish-audio/s1', voice: null, params: {} });
  assert.equal(label, 'fish-audio/s1 · default voice');
});

test('lists several params in a stable order', () => {
  const label = formatTakeLabel({
    model: 'a/b',
    voice: 'v',
    params: { top_p: 0.9, temperature: 0.5 },
  });
  assert.equal(label, 'a/b · v · temperature 0.5 · top_p 0.9');
});

test('omits the param section when there are none', () => {
  assert.equal(formatTakeLabel({ model: 'a/b', voice: 'v', params: {} }), 'a/b · v');
});

test('tolerates a missing params object', () => {
  assert.equal(formatTakeLabel({ model: 'a/b', voice: 'v' }), 'a/b · v');
});

test('formats byte counts', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});
