/** Approximate. OpenRouter's `prompt` rate is per character for the
 *  per-character TTS providers, but the basis is not uniform across models,
 *  so this is always presented to the user as an estimate. */
export function estimateCost(model, charCount) {
  const rate = Number.parseFloat(model?.pricing?.prompt ?? '0');
  if (!Number.isFinite(rate)) return 0;
  // Round to 10 decimal places to avoid floating-point precision issues
  return Math.round(rate * charCount * 1e10) / 1e10;
}

export function estimateTotal(jobs, charCount) {
  return jobs.reduce((sum, job) => sum + estimateCost(job.model, charCount), 0);
}

export function formatCost(usd) {
  if (usd === 0) return 'free';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}
