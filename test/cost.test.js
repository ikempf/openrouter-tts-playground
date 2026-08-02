import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, estimateTotal, formatCost } from '../js/cost.js';

const grok = { id: 'x-ai/grok-voice-tts-1.0', pricing: { prompt: '0.000015' } };
const free = { id: 'fish-audio/s2.1-pro-free:free', pricing: { prompt: '0' } };

test('estimates cost from the prompt rate and character count', () => {
  assert.equal(estimateCost(grok, 500), 0.0075);
});

test('a zero rate costs nothing', () => {
  assert.equal(estimateCost(free, 500), 0);
});

test('missing or unparseable pricing counts as zero', () => {
  assert.equal(estimateCost({ id: 'a/b' }, 500), 0);
  assert.equal(estimateCost({ id: 'a/b', pricing: { prompt: 'n/a' } }, 500), 0);
});

test('total sums every job, so repeated models count repeatedly', () => {
  const jobs = [{ model: grok }, { model: grok }, { model: free }];
  assert.equal(estimateTotal(jobs, 500), 0.015);
});

test('total of no jobs is zero', () => {
  assert.equal(estimateTotal([], 500), 0);
});

test('formatCost labels zero as free', () => {
  assert.equal(formatCost(0), 'free');
});

test('formatCost collapses sub-cent amounts', () => {
  assert.equal(formatCost(0.0075), '<$0.01');
});

test('formatCost shows two decimals above a cent', () => {
  assert.equal(formatCost(0.09), '$0.09');
  assert.equal(formatCost(1.5), '$1.50');
});
