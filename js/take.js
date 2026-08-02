/** The take record: one synthesis attempt with everything needed to understand
 *  and reproduce it. Four other modules read this shape, so it is built here,
 *  as a pure mapping from (job, result, id) -- no DOM, no storage, no clock
 *  unless one is passed in.
 *
 *  Nothing here may read live UI state. The worker that calls it runs after an
 *  `await synthesize(...)`, seconds after the click, by which point the form
 *  may already describe the *next* batch. Everything the record needs about
 *  the form therefore arrives on the job, snapshotted at click time. */
export function createTake({ job, result, id, ts = Date.now() }) {
  // job.take is present only on a retry and is the take that was actually
  // resent: its style/text/params are what was in effect when that take was
  // first recorded. Otherwise the job itself carries the same fields,
  // captured at click time.
  const source = job.take ?? job;
  return {
    id,
    model: job.modelId,
    voice: job.voice ?? null,
    style: source.style,
    text: source.text,
    params: { ...source.params },
    requestBody: job.body,
    ts,
    favourite: false,
    status: result.error ? 'error' : 'ok',
    error: result.error ?? null,
  };
}
