import test from 'node:test';
import assert from 'node:assert/strict';
import { runPool } from '../js/pool.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('returns results in input order regardless of completion order', async () => {
  const items = [30, 5, 15];
  const results = await runPool(items, 3, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ms;
  });
  assert.deepEqual(results, [30, 5, 15]);
});

test('never exceeds the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight -= 1;
  });
  assert.equal(peak, 3);
});

test('processes every item', async () => {
  const seen = [];
  await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    await tick();
    seen.push(n);
  });
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('passes the index to the worker', async () => {
  const results = await runPool(['a', 'b'], 1, async (item, i) => `${i}:${item}`);
  assert.deepEqual(results, ['0:a', '1:b']);
});

test('an empty list resolves to an empty array', async () => {
  assert.deepEqual(await runPool([], 3, async () => 'x'), []);
});

test('a limit larger than the item count is harmless', async () => {
  assert.deepEqual(await runPool([1, 2], 10, async (n) => n * 2), [2, 4]);
});
