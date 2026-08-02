/** Runs `worker` over `items` with at most `limit` concurrent calls.
 *  Results keep input order. The worker is expected not to throw — callers
 *  return error objects so that one failed job cannot abort the batch. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => runner(),
  );
  await Promise.all(runners);
  return results;
}
