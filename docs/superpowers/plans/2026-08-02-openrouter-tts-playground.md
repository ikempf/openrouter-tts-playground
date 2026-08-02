# OpenRouter TTS Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static browser page for auditioning OpenRouter TTS models and voices, where every result carries the exact request that produced it.

**Architecture:** A no-build page of vanilla ES modules calling OpenRouter directly from the browser (CORS is open). All decision logic lives in pure modules that take injected `fetch` and storage backends, so it is unit-testable under `node --test` with no browser and no dependencies. The DOM layer is a thin renderer over those modules.

**Tech Stack:** Vanilla JavaScript ES modules, `node --test` for tests, `python3 -m http.server` for serving. Zero runtime dependencies.

## Global Constraints

- **No runtime dependencies, no bundler, no framework.** `package.json` exists only for `"type": "module"` and the test script. Its `dependencies` and `devDependencies` must stay absent.
- **Serve over http, never `file://`.** ES modules do not load from `file://`, and localStorage is per-origin. Always `python3 -m http.server 8080` → `http://localhost:8080`.
- **`js/request.js`, `js/cost.js`, `js/pool.js` are pure.** No `fetch`, no DOM, no storage access. This is what makes them testable.
- **Network and storage are injected.** `loadCatalog`, `synthesize`, and `createStore` all take their backend as a parameter defaulting to the real one.
- **Never treat a response body as audio without checking `response.ok` AND `content-type`.** An error arrives as JSON; writing it to a `.mp3` is the bug this project exists because of.
- **Parameter whitelist is exactly:** `temperature`, `top_p`, `seed`, `speed`, `top_k`, `min_p`, `repetition_penalty`. `response_format` is excluded — it is a first-class body field.
- **API endpoints:**
  - `https://openrouter.ai/api/v1/models?output_modalities=speech` (no auth)
  - `https://openrouter.ai/api/v1/audio/speech` (Bearer key)
- **Never commit an API key.** `.gitignore` already covers `*.mp3`, `*.wav`, `*.pcm`, `.env`.
- **Storage keys are namespaced `or_tts.*`** in localStorage; the IndexedDB database is `or-tts-playground` with one object store, `audio`.

## File Structure

| file | responsibility |
|---|---|
| `package.json` | `type: module` + test script. No dependencies. |
| `index.html` | Static shell: form controls and take-log container. |
| `css/app.css` | Layout and styling. |
| `js/request.js` | **Pure.** `buildRequest`, `expandJobs`, `deepMerge`, `PARAM_WHITELIST`. |
| `js/models.js` | Catalog fetch + `normalizeModel`. |
| `js/cost.js` | **Pure.** `estimateCost`, `estimateTotal`, `formatCost`. |
| `js/pool.js` | **Pure.** `runPool` — bounded-concurrency runner. |
| `js/tts.js` | `synthesize` — POST, and the audio-vs-error guard. |
| `js/store.js` | `createStore` over injected localStorage + audio backend; `createIdbAudioStore`. |
| `js/takes.js` | `formatTakeLabel` (pure) + take-card DOM rendering. |
| `js/main.js` | Wiring: form state, fan-out, concurrency, cost preview, banners. |
| `test/*.test.js` | One file per pure/injectable module. |

**Test command:** `npm test`, which runs bare `node --test`. Node 26 rejects a
directory argument — `node --test test/` fails with MODULE_NOT_FOUND — while
bare `node --test` discovers `test/*.test.js` correctly.

---

### Task 1: Scaffold and `buildRequest`

**Files:**
- Create: `package.json`
- Create: `js/request.js`
- Test: `test/request.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PARAM_WHITELIST: string[]`
  - `deepMerge(base: object, override: object) → object`
  - `buildRequest({ model, voice, text, style, params, responseFormat, rawOverrides }) → object`
  - `model` here is a normalized model from Task 3: `{ id, name, voices, freeTextVoice, supported_parameters, tunables, pricing }`. Task 1 only reads `.id` and `.supported_parameters`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "openrouter-tts-playground",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "python3 -m http.server 8080"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/request.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/request.js'`

- [ ] **Step 4: Write the implementation**

Create `js/request.js`:

```js
/** Parameters that are meaningful for speech synthesis.
 *  Deliberately excludes response_format (a first-class body field) and the
 *  LLM-shaped params some TTS models report, such as logprobs and stop. */
export const PARAM_WHITELIST = [
  'temperature',
  'top_p',
  'seed',
  'speed',
  'top_k',
  'min_p',
  'repetition_penalty',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key], value)
      : value;
  }
  return out;
}

export function buildRequest({
  model,
  voice,
  text,
  style,
  params = {},
  responseFormat = 'mp3',
  rawOverrides = {},
}) {
  const trimmedStyle = (style ?? '').trim();
  const body = {
    model: model.id,
    input: trimmedStyle ? `${trimmedStyle}\n\n${text}` : text,
  };

  if (voice) body.voice = voice;
  body.response_format = responseFormat;

  const supported = new Set(model.supported_parameters ?? []);
  for (const name of PARAM_WHITELIST) {
    if (!supported.has(name)) continue;
    const value = params[name];
    if (value === undefined || value === null || value === '') continue;
    body[name] = value;
  }

  return deepMerge(body, rawOverrides);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json js/request.js test/request.test.js
git commit -m "feat: build TTS request bodies with param filtering and overrides"
```

---

### Task 2: `expandJobs` — fan-out

**Files:**
- Modify: `js/request.js`
- Test: `test/request.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the same file.
- Produces:
  - `normalizeVoiceSelection(raw: string[] | string | undefined) → string[]`
  - `expandJobs({ models, voicesByModel }) → Array<{ model, voice: string|null }>`
  - `voicesByModel` is keyed by `model.id`. Values are `string[]` for dropdown models and a comma-separated `string` for free-text models.

- [ ] **Step 1: Write the failing test**

Append to `test/request.test.js`:

```js
import { expandJobs, normalizeVoiceSelection } from '../js/request.js';

const kokoro = { id: 'hexgrad/kokoro-82m', supported_parameters: ['temperature'] };
const fish = { id: 'fish-audio/s1', supported_parameters: [] };

test('pairs each voice only with its owning model', () => {
  const jobs = expandJobs({
    models: [grok, kokoro],
    voicesByModel: {
      'x-ai/grok-voice-tts-1.0': ['rex'],
      'hexgrad/kokoro-82m': ['af_bella'],
    },
  });
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((j) => [j.model.id, j.voice]),
    [['x-ai/grok-voice-tts-1.0', 'rex'], ['hexgrad/kokoro-82m', 'af_bella']],
  );
});

test('expands multiple voices for one model', () => {
  const jobs = expandJobs({
    models: [grok],
    voicesByModel: { 'x-ai/grok-voice-tts-1.0': ['rex', 'leo', 'eve'] },
  });
  assert.deepEqual(jobs.map((j) => j.voice), ['rex', 'leo', 'eve']);
});

test('splits comma-separated free-text voices', () => {
  const jobs = expandJobs({
    models: [fish],
    voicesByModel: { 'fish-audio/s1': 'speaker_a, speaker_b' },
  });
  assert.deepEqual(jobs.map((j) => j.voice), ['speaker_a', 'speaker_b']);
});

test('a model with no voice selected yields one job with a null voice', () => {
  const jobs = expandJobs({ models: [fish], voicesByModel: {} });
  assert.deepEqual(jobs, [{ model: fish, voice: null }]);
});

test('a model with a blank free-text voice yields one job with a null voice', () => {
  const jobs = expandJobs({ models: [fish], voicesByModel: { 'fish-audio/s1': '  ,  ' } });
  assert.deepEqual(jobs, [{ model: fish, voice: null }]);
});

test('no models selected yields no jobs', () => {
  assert.deepEqual(expandJobs({ models: [], voicesByModel: {} }), []);
});

test('normalizeVoiceSelection trims and drops blanks', () => {
  assert.deepEqual(normalizeVoiceSelection(' a , ,b '), ['a', 'b']);
  assert.deepEqual(normalizeVoiceSelection(['a', '', ' b ']), ['a', 'b']);
  assert.deepEqual(normalizeVoiceSelection(undefined), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `expandJobs is not a function` / import error.

- [ ] **Step 3: Write the implementation**

Append to `js/request.js`:

```js
export function normalizeVoiceSelection(raw) {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return parts.map((v) => String(v).trim()).filter(Boolean);
}

/** Voices belong to models, so this is not a blind cross product:
 *  a job exists only where a voice was chosen for that specific model. */
export function expandJobs({ models, voicesByModel = {} }) {
  const jobs = [];
  for (const model of models) {
    const voices = normalizeVoiceSelection(voicesByModel[model.id]);
    if (voices.length === 0) {
      jobs.push({ model, voice: null });
      continue;
    }
    for (const voice of voices) jobs.push({ model, voice });
  }
  return jobs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add js/request.js test/request.test.js
git commit -m "feat: expand model and voice selections into jobs"
```

---

### Task 3: `models.js` — catalog

**Files:**
- Create: `js/models.js`
- Test: `test/models.test.js`

**Interfaces:**
- Consumes: `PARAM_WHITELIST` from `js/request.js`.
- Produces:
  - `CATALOG_URL: string`
  - `normalizeModel(raw) → { id, name, voices, freeTextVoice, supported_parameters, tunables, pricing }`
  - `loadCatalog(fetchImpl?) → Promise<Model[]>`

- [ ] **Step 1: Write the failing test**

Create `test/models.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, loadCatalog, CATALOG_URL } from '../js/models.js';

const rawGrok = {
  id: 'x-ai/grok-voice-tts-1.0',
  name: 'xAI: Grok Voice TTS 1.0',
  supported_voices: ['eve', 'ara', 'rex', 'sal', 'leo'],
  supported_parameters: ['temperature', 'top_p', 'seed', 'logprobs', 'stop'],
  pricing: { prompt: '0.000015', completion: '0' },
};

const rawFish = {
  id: 'fish-audio/s1',
  name: 'Fish Audio: S1',
  supported_voices: null,
  supported_parameters: [],
  pricing: { prompt: '0.000015', completion: '0' },
};

test('normalizes a model with voices', () => {
  const model = normalizeModel(rawGrok);
  assert.deepEqual(model.voices, ['eve', 'ara', 'rex', 'sal', 'leo']);
  assert.equal(model.freeTextVoice, false);
});

test('null supported_voices becomes free-text mode with an empty list', () => {
  const model = normalizeModel(rawFish);
  assert.deepEqual(model.voices, []);
  assert.equal(model.freeTextVoice, true);
});

test('tunables intersect the whitelist with what the model supports', () => {
  const model = normalizeModel(rawGrok);
  assert.deepEqual(model.tunables, ['temperature', 'top_p', 'seed']);
});

test('a model supporting nothing has no tunables', () => {
  assert.deepEqual(normalizeModel(rawFish).tunables, []);
});

test('falls back to the id when name is missing', () => {
  assert.equal(normalizeModel({ id: 'a/b' }).name, 'a/b');
});

test('missing arrays and pricing do not throw', () => {
  const model = normalizeModel({ id: 'a/b' });
  assert.deepEqual(model.voices, []);
  assert.deepEqual(model.tunables, []);
  assert.equal(model.pricing.prompt, '0');
});

test('loadCatalog fetches the speech-only catalog and sorts by id', async () => {
  let calledWith = null;
  const fakeFetch = async (url) => {
    calledWith = url;
    return { ok: true, status: 200, json: async () => ({ data: [rawGrok, rawFish] }) };
  };
  const models = await loadCatalog(fakeFetch);
  assert.equal(calledWith, CATALOG_URL);
  assert.ok(CATALOG_URL.includes('output_modalities=speech'));
  assert.deepEqual(models.map((m) => m.id), ['fish-audio/s1', 'x-ai/grok-voice-tts-1.0']);
});

test('loadCatalog throws a useful message on a failed fetch', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => loadCatalog(fakeFetch), /503/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/models.js'`

- [ ] **Step 3: Write the implementation**

Create `js/models.js`:

```js
import { PARAM_WHITELIST } from './request.js';

export const CATALOG_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=speech';

/** Some models report supported_voices: null (Fish Audio, MiniMax).
 *  Those get a free-text voice field rather than an empty dropdown. */
export function normalizeModel(raw) {
  const voices = Array.isArray(raw.supported_voices) ? raw.supported_voices : [];
  const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    voices,
    freeTextVoice: voices.length === 0,
    supported_parameters: supported,
    tunables: PARAM_WHITELIST.filter((p) => supported.includes(p)),
    pricing: raw.pricing ?? { prompt: '0' },
  };
}

export async function loadCatalog(fetchImpl = fetch) {
  const res = await fetchImpl(CATALOG_URL);
  if (!res.ok) throw new Error(`Catalog fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? [])
    .map(normalizeModel)
    .sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 29 tests.

- [ ] **Step 5: Commit**

```bash
git add js/models.js test/models.test.js
git commit -m "feat: load and normalize the OpenRouter speech model catalog"
```

---

### Task 4: `cost.js` — estimation

**Files:**
- Create: `js/cost.js`
- Test: `test/cost.test.js`

**Interfaces:**
- Consumes: normalized models from Task 3 (reads `.pricing.prompt`).
- Produces:
  - `estimateCost(model, charCount) → number` (USD)
  - `estimateTotal(jobs, charCount) → number` where `jobs` are from `expandJobs`
  - `formatCost(usd) → string`

- [ ] **Step 1: Write the failing test**

Create `test/cost.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/cost.js'`

- [ ] **Step 3: Write the implementation**

Create `js/cost.js`:

```js
/** Approximate. OpenRouter's `prompt` rate is per character for the
 *  per-character TTS providers, but the basis is not uniform across models,
 *  so this is always presented to the user as an estimate. */
export function estimateCost(model, charCount) {
  const rate = Number.parseFloat(model?.pricing?.prompt ?? '0');
  if (!Number.isFinite(rate)) return 0;
  return rate * charCount;
}

export function estimateTotal(jobs, charCount) {
  return jobs.reduce((sum, job) => sum + estimateCost(job.model, charCount), 0);
}

export function formatCost(usd) {
  if (usd === 0) return 'free';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 37 tests.

- [ ] **Step 5: Commit**

```bash
git add js/cost.js test/cost.test.js
git commit -m "feat: estimate fan-out cost from model pricing"
```

---

### Task 5: `pool.js` — bounded concurrency

**Files:**
- Create: `js/pool.js`
- Test: `test/pool.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `runPool(items, limit, worker) → Promise<any[]>`. Results are in input order. `worker(item, index)` must not throw — callers return error objects instead.

- [ ] **Step 1: Write the failing test**

Create `test/pool.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/pool.js'`

- [ ] **Step 3: Write the implementation**

Create `js/pool.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 43 tests.

- [ ] **Step 5: Commit**

```bash
git add js/pool.js test/pool.test.js
git commit -m "feat: add bounded-concurrency job runner"
```

---

### Task 6: `tts.js` — synthesis and the audio guard

**Files:**
- Create: `js/tts.js`
- Test: `test/tts.test.js`

**Interfaces:**
- Consumes: a body from `buildRequest`.
- Produces:
  - `SPEECH_URL: string`
  - `synthesize({ apiKey, body, fetchImpl? }) → Promise<{ blob, generationId } | { error: { code, message } }>`
  - `error.code` is the HTTP status number, or one of the strings `'network'`, `'unexpected-type'`.

This is the task that exists because error JSON was previously written to `.mp3` files. The guard is the point.

- [ ] **Step 1: Write the failing test**

Create `test/tts.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/tts.js'`

- [ ] **Step 3: Write the implementation**

Create `js/tts.js`:

```js
export const SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';

async function readErrorMessage(res) {
  try {
    const json = await res.json();
    return json?.error?.message ?? JSON.stringify(json);
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Returns { blob, generationId } or { error: { code, message } }.
 *
 *  The endpoint answers with raw audio bytes on success and JSON on failure,
 *  and a failure can still arrive with a 200. Checking only `ok`, or only the
 *  status, is how an error body ends up saved as a .mp3 that will not play. */
export async function synthesize({ apiKey, body, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    return { error: { code: 'network', message: cause.message } };
  }

  const contentType = res.headers.get('content-type') ?? '';

  if (!res.ok || contentType.includes('application/json')) {
    return { error: { code: res.status, message: await readErrorMessage(res) } };
  }

  if (!contentType.startsWith('audio/')) {
    return {
      error: {
        code: 'unexpected-type',
        message: `Expected audio, received ${contentType || 'no content-type'}`,
      },
    };
  }

  return {
    blob: await res.blob(),
    generationId: res.headers.get('x-generation-id'),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 51 tests.

- [ ] **Step 5: Commit**

```bash
git add js/tts.js test/tts.test.js
git commit -m "feat: synthesize speech and never mistake an error body for audio"
```

---

### Task 7: `store.js` — persistence

**Files:**
- Create: `js/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: take objects assembled in Task 10.
- Produces:
  - `createStore({ storage?, audio? }) → store`
  - Store methods: `getApiKey()`, `setApiKey(key)`, `getForm()`, `setForm(form)`, `getCatalog()`, `setCatalog(models)`, `listTakes()`, `addTake(take)`, `updateTake(id, patch)`, `removeTake(id)`, `putAudio(id, blob)`, `getAudio(id)`, `clearAudio()`, `audioUsage()`
  - `createMemoryAudioStore()` — the in-memory audio backend used by tests
  - `createIdbAudioStore()` — the real IndexedDB backend
  - Audio backend interface: `{ put(id, blob), get(id), remove(id), clear(), usage() }`, all async.
  - A take: `{ id, model, voice, style, text, params, requestBody, ts, favourite, status, error }`

- [ ] **Step 1: Write the failing test**

Create `test/store.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/store.js'`

- [ ] **Step 3: Write the implementation**

Create `js/store.js`:

```js
const KEYS = {
  apiKey: 'or_tts.api_key',
  form: 'or_tts.form',
  takes: 'or_tts.takes',
  catalog: 'or_tts.catalog',
};

const DB_NAME = 'or-tts-playground';
const DB_VERSION = 1;
const AUDIO_STORE = 'audio';

function readJson(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function createMemoryAudioStore() {
  const blobs = new Map();
  return {
    async put(id, blob) { blobs.set(id, blob); },
    async get(id) { return blobs.get(id); },
    async remove(id) { blobs.delete(id); },
    async clear() { blobs.clear(); },
    async usage() {
      let total = 0;
      for (const blob of blobs.values()) total += blob.size;
      return total;
    },
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE, mode);
    const request = run(transaction.objectStore(AUDIO_STORE));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    if (request) request.onsuccess = () => resolve(request.result);
    else transaction.oncomplete = () => resolve(undefined);
  });
}

export function createIdbAudioStore() {
  let dbPromise = null;
  const db = () => (dbPromise ??= openDb());
  return {
    async put(id, blob) { await tx(await db(), 'readwrite', (s) => s.put(blob, id)); },
    async get(id) { return tx(await db(), 'readonly', (s) => s.get(id)); },
    async remove(id) { await tx(await db(), 'readwrite', (s) => s.delete(id)); },
    async clear() { await tx(await db(), 'readwrite', (s) => s.clear()); },
    async usage() {
      const blobs = await tx(await db(), 'readonly', (s) => s.getAll());
      return (blobs ?? []).reduce((total, blob) => total + (blob?.size ?? 0), 0);
    },
  };
}

export function createStore({ storage = localStorage, audio = createIdbAudioStore() } = {}) {
  const writeTakes = (takes) => storage.setItem(KEYS.takes, JSON.stringify(takes));
  const readTakes = () => readJson(storage, KEYS.takes, []);

  return {
    getApiKey: () => storage.getItem(KEYS.apiKey) ?? '',
    setApiKey: (key) => storage.setItem(KEYS.apiKey, key),

    getForm: () => readJson(storage, KEYS.form, {}),
    setForm: (form) => storage.setItem(KEYS.form, JSON.stringify(form)),

    getCatalog: () => readJson(storage, KEYS.catalog, null),
    setCatalog: (models) => storage.setItem(KEYS.catalog, JSON.stringify(models)),

    listTakes: () => [...readTakes()].sort((a, b) => b.ts - a.ts),
    addTake(take) { writeTakes([...readTakes(), take]); },
    updateTake(id, patch) {
      writeTakes(readTakes().map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    async removeTake(id) {
      writeTakes(readTakes().filter((t) => t.id !== id));
      await audio.remove(id);
    },

    async putAudio(id, blob) {
      try {
        await audio.put(id, blob);
        return { ok: true };
      } catch (cause) {
        return { ok: false, message: `Could not store audio: ${cause.message}` };
      }
    },
    getAudio: (id) => audio.get(id),
    clearAudio: () => audio.clear(),
    audioUsage: () => audio.usage(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 63 tests.

Note: `createIdbAudioStore` is not covered by these tests — it needs a real browser and is verified by hand in Task 11.

- [ ] **Step 5: Commit**

```bash
git add js/store.js test/store.test.js
git commit -m "feat: persist config in localStorage and audio in IndexedDB"
```

---

### Task 8: `index.html` and `css/app.css` — the shell

**Files:**
- Create: `index.html`
- Create: `css/app.css`

**Interfaces:**
- Consumes: nothing yet — `js/main.js` arrives in Task 10.
- Produces: these element ids, which Tasks 9 and 10 query by name:
  `#banner`, `#api-key`, `#save-key`, `#catalog-status`, `#refresh-catalog`,
  `#model-list`, `#voice-panel`, `#params`, `#response-format`, `#style`,
  `#text`, `#raw-overrides`, `#request-preview`, `#cost-estimate`, `#generate`,
  `#take-count`, `#takes`, `#storage-usage`, `#clear-audio`

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenRouter TTS Playground</title>
<link rel="stylesheet" href="css/app.css">
</head>
<body>
<header>
  <h1>OpenRouter TTS Playground</h1>
  <div class="key-row">
    <input id="api-key" type="password" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false">
    <button id="save-key" type="button">Save key</button>
  </div>
</header>

<div id="banner" class="banner" hidden></div>

<main>
  <section class="config">
    <div class="field">
      <label>Models <span id="catalog-status" class="hint"></span>
        <button id="refresh-catalog" type="button" class="link">refresh</button>
      </label>
      <div id="model-list" class="model-list"></div>
    </div>

    <div class="field">
      <label>Voices</label>
      <div id="voice-panel" class="voice-panel"></div>
    </div>

    <div class="field">
      <label for="style">Style <span class="hint">prepended to the text</span></label>
      <input id="style" type="text" placeholder="(gravelly, unhurried)">
    </div>

    <div class="field">
      <label>Parameters</label>
      <div id="params" class="params"></div>
      <label for="response-format" class="inline">Format
        <select id="response-format">
          <option value="mp3">mp3</option>
          <option value="pcm">pcm</option>
        </select>
      </label>
    </div>

    <div class="field">
      <label for="text">Text</label>
      <textarea id="text" rows="5" placeholder="The old lighthouse had not been lit in forty years."></textarea>
    </div>

    <details>
      <summary>Raw request overrides (JSON, merged last)</summary>
      <textarea id="raw-overrides" rows="4" spellcheck="false"
        placeholder='{ "provider": { "style": "newscast", "styledegree": 1.4 } }'></textarea>
    </details>

    <details>
      <summary>Request preview</summary>
      <pre id="request-preview"></pre>
    </details>

    <div class="actions">
      <button id="generate" type="button">Generate</button>
      <span id="cost-estimate" class="hint"></span>
    </div>
  </section>

  <section class="takes">
    <h2>Takes <span id="take-count" class="hint"></span></h2>
    <div id="takes"></div>
    <p class="hint">
      <span id="storage-usage"></span>
      <button id="clear-audio" type="button" class="link">clear stored audio</button>
    </p>
  </section>
</main>

<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `css/app.css`**

```css
:root {
  --bg: #14161a;
  --panel: #1c1f26;
  --line: #2c313b;
  --fg: #e6e8ec;
  --muted: #8b94a5;
  --accent: #6ea8fe;
  --danger: #ff8a8a;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 1.5rem;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.5 system-ui, sans-serif;
}

h1 { font-size: 1.15rem; margin: 0; }
h2 { font-size: 1rem; margin: 0 0 .75rem; }

header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.key-row { display: flex; gap: .5rem; }

main {
  display: grid;
  grid-template-columns: minmax(320px, 420px) 1fr;
  gap: 1.5rem;
  align-items: start;
}

@media (max-width: 800px) { main { grid-template-columns: 1fr; } }

.config, .takes {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem;
}

.field { margin-bottom: 1rem; }
label { display: block; margin-bottom: .35rem; font-weight: 500; }
label.inline { display: inline-block; margin-top: .5rem; }

input, textarea, select, button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: .4rem .5rem;
}

input[type="text"], input[type="password"], textarea { width: 100%; }
textarea { resize: vertical; }

button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }

button.link {
  background: none;
  border: none;
  color: var(--accent);
  padding: 0;
  text-decoration: underline;
}

.hint { color: var(--muted); font-weight: 400; font-size: .85em; }

.model-list, .voice-panel {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: .5rem;
}

.model-list label, .voice-panel label {
  display: flex;
  gap: .4rem;
  align-items: center;
  font-weight: 400;
  margin: 0 0 .2rem;
}

.voice-group { margin-bottom: .6rem; }
.voice-group > strong { font-size: .85em; color: var(--muted); }
.voice-options { display: flex; flex-wrap: wrap; gap: .5rem; }

.params { display: flex; flex-wrap: wrap; gap: .75rem; }
.params label { font-weight: 400; }
.params input { width: 6rem; }

details { margin-bottom: 1rem; }
summary { cursor: pointer; color: var(--muted); }
pre {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: .6rem;
  overflow-x: auto;
  font-size: .85em;
  margin: .5rem 0 0;
}

.actions { display: flex; gap: .75rem; align-items: center; }

.banner {
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: 5px;
  padding: .6rem .8rem;
  margin-bottom: 1rem;
}

.take {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: .6rem .75rem;
  margin-bottom: .6rem;
}
.take.error { border-color: var(--danger); }
.take-head {
  display: flex;
  justify-content: space-between;
  gap: .5rem;
  font-size: .9em;
  margin-bottom: .4rem;
}
.take-label { font-family: ui-monospace, monospace; }
.take audio { width: 100%; margin: .3rem 0; }
.take-actions { display: flex; gap: .6rem; flex-wrap: wrap; }
.take-error { color: var(--danger); font-size: .9em; margin: .3rem 0; }
.favourite[aria-pressed="true"] { color: #ffd166; }
```

- [ ] **Step 3: Verify it renders**

Run: `python3 -m http.server 8080` and open `http://localhost:8080`.
Expected: the two-column layout appears with the key field, empty model and voice boxes, style, text, both collapsed `<details>` panels, a Generate button, and an empty Takes panel. The console shows a 404 for `js/main.js` — that is expected until Task 10.

- [ ] **Step 4: Commit**

```bash
git add index.html css/app.css
git commit -m "feat: add page shell and styles"
```

---

### Task 9: `takes.js` — take rendering

**Files:**
- Create: `js/takes.js`
- Test: `test/takes.test.js`

**Interfaces:**
- Consumes: a take object from Task 7, and `formatCost` is not used here.
- Produces:
  - `formatTakeLabel(take) → string` — e.g. `x-ai/grok-voice-tts-1.0 · rex · temp 0.7`
  - `formatTime(ts) → string` — `HH:MM`
  - `formatBytes(bytes) → string`
  - `renderTake(take, { audioUrl, handlers }) → HTMLElement` where `handlers` is
    `{ onDownload, onClone, onCopy, onFavourite, onRetry, onDelete }`

Only the pure formatters are unit-tested; `renderTake` needs a DOM and is checked by hand in Task 11.

- [ ] **Step 1: Write the failing test**

Create `test/takes.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../js/takes.js'`

- [ ] **Step 3: Write the implementation**

Create `js/takes.js`:

```js
export function formatTakeLabel(take) {
  const parts = [take.model, take.voice ?? 'default voice'];
  const params = Object.entries(take.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of params) parts.push(`${name} ${value}`);
  return parts.join(' · ');
}

export function formatTime(ts) {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function button(text, title, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'link';
  el.textContent = text;
  el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

export function renderTake(take, { audioUrl, handlers }) {
  const root = document.createElement('article');
  root.className = take.status === 'error' ? 'take error' : 'take';
  root.dataset.takeId = take.id;

  const head = document.createElement('div');
  head.className = 'take-head';
  const label = document.createElement('span');
  label.className = 'take-label';
  label.textContent = formatTakeLabel(take);
  const time = document.createElement('span');
  time.className = 'hint';
  time.textContent = formatTime(take.ts);
  head.append(label, time);
  root.append(head);

  if (take.status === 'error') {
    const error = document.createElement('p');
    error.className = 'take-error';
    error.textContent = `${take.error.code}: ${take.error.message}`;
    root.append(error);
  } else if (audioUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = audioUrl;
    root.append(audio);
  } else {
    const missing = document.createElement('p');
    missing.className = 'hint';
    missing.textContent = 'audio not stored';
    root.append(missing);
  }

  const actions = document.createElement('div');
  actions.className = 'take-actions';

  if (take.status === 'ok' && audioUrl) {
    actions.append(button('download', 'Download audio', () => handlers.onDownload(take)));
  }
  if (take.status === 'error') {
    actions.append(button('retry', 'Run this request again', () => handlers.onRetry(take)));
  }
  actions.append(
    button('clone to form', 'Load this config into the form', () => handlers.onClone(take)),
    button('copy JSON', 'Copy the exact request body', () => handlers.onCopy(take)),
    button('delete', 'Remove this take', () => handlers.onDelete(take)),
  );

  const fav = button(take.favourite ? '★' : '☆', 'Favourite', () => handlers.onFavourite(take));
  fav.classList.add('favourite');
  fav.setAttribute('aria-pressed', String(Boolean(take.favourite)));
  actions.append(fav);

  root.append(actions);
  return root;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 69 tests.

- [ ] **Step 5: Commit**

```bash
git add js/takes.js test/takes.test.js
git commit -m "feat: render take cards with player and actions"
```

---

### Task 10: `main.js` — wiring

**Files:**
- Create: `js/main.js`

**Interfaces:**
- Consumes: everything above — `buildRequest`, `expandJobs` (`js/request.js`); `loadCatalog` (`js/models.js`); `estimateTotal`, `formatCost` (`js/cost.js`); `runPool` (`js/pool.js`); `synthesize` (`js/tts.js`); `createStore` (`js/store.js`); `renderTake`, `formatBytes` (`js/takes.js`).
- Produces: no exports. This is the entry point.

- [ ] **Step 1: Write the implementation**

Create `js/main.js`:

```js
import { buildRequest, expandJobs } from './request.js';
import { loadCatalog } from './models.js';
import { estimateTotal, formatCost } from './cost.js';
import { runPool } from './pool.js';
import { synthesize } from './tts.js';
import { createStore } from './store.js';
import { renderTake, formatBytes } from './takes.js';

const CONCURRENCY = 3;

const store = createStore({});
const el = (id) => document.getElementById(id);
const ui = {
  banner: el('banner'),
  apiKey: el('api-key'),
  saveKey: el('save-key'),
  catalogStatus: el('catalog-status'),
  refreshCatalog: el('refresh-catalog'),
  modelList: el('model-list'),
  voicePanel: el('voice-panel'),
  params: el('params'),
  responseFormat: el('response-format'),
  style: el('style'),
  text: el('text'),
  rawOverrides: el('raw-overrides'),
  requestPreview: el('request-preview'),
  costEstimate: el('cost-estimate'),
  generate: el('generate'),
  takeCount: el('take-count'),
  takes: el('takes'),
  storageUsage: el('storage-usage'),
  clearAudio: el('clear-audio'),
};

let catalog = [];
let selectedModelIds = [];
let voicesByModel = {};
let params = {};
const audioUrls = new Map();

function showBanner(message) {
  ui.banner.textContent = message;
  ui.banner.hidden = false;
}

function clearBanner() {
  ui.banner.hidden = true;
}

const selectedModels = () => catalog.filter((m) => selectedModelIds.includes(m.id));

function parseOverrides() {
  const raw = ui.rawOverrides.value.trim();
  if (!raw) return { value: {} };
  try {
    const value = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { error: 'Overrides must be a JSON object.' };
    }
    return { value };
  } catch (cause) {
    return { error: `Overrides are not valid JSON: ${cause.message}` };
  }
}

function currentJobs() {
  return expandJobs({ models: selectedModels(), voicesByModel });
}

function saveForm() {
  store.setForm({
    selectedModelIds,
    voicesByModel,
    params,
    style: ui.style.value,
    text: ui.text.value,
    responseFormat: ui.responseFormat.value,
    rawOverrides: ui.rawOverrides.value,
  });
}

function refreshPreview() {
  const jobs = currentJobs();
  const overrides = parseOverrides();

  ui.generate.disabled = jobs.length === 0 || Boolean(overrides.error);

  if (overrides.error) {
    ui.requestPreview.textContent = overrides.error;
    ui.costEstimate.textContent = '';
    return;
  }
  if (jobs.length === 0) {
    ui.requestPreview.textContent = 'Select at least one model.';
    ui.costEstimate.textContent = '';
    return;
  }

  const [first] = jobs;
  ui.requestPreview.textContent = JSON.stringify(
    buildRequest({
      model: first.model,
      voice: first.voice,
      text: ui.text.value,
      style: ui.style.value,
      params,
      responseFormat: ui.responseFormat.value,
      rawOverrides: overrides.value,
    }),
    null,
    2,
  );

  const cost = estimateTotal(jobs, ui.text.value.length);
  const plural = jobs.length === 1 ? '' : 's';
  ui.costEstimate.textContent = `${jobs.length} take${plural}, about ${formatCost(cost)}`;
}

function renderModels() {
  ui.modelList.replaceChildren();
  for (const model of catalog) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = model.id;
    box.checked = selectedModelIds.includes(model.id);
    box.addEventListener('change', () => {
      selectedModelIds = box.checked
        ? [...selectedModelIds, model.id]
        : selectedModelIds.filter((id) => id !== model.id);
      renderVoices();
      renderParams();
      saveForm();
      refreshPreview();
    });
    const text = document.createElement('span');
    text.textContent = model.id;
    label.append(box, text);
    ui.modelList.append(label);
  }
}

function renderVoices() {
  ui.voicePanel.replaceChildren();
  const models = selectedModels();
  if (models.length === 0) {
    ui.voicePanel.textContent = 'Select a model first.';
    return;
  }

  for (const model of models) {
    const group = document.createElement('div');
    group.className = 'voice-group';
    const title = document.createElement('strong');
    title.textContent = model.id;
    group.append(title);

    if (model.freeTextVoice) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'voice id, comma-separated for several';
      input.value = typeof voicesByModel[model.id] === 'string' ? voicesByModel[model.id] : '';
      input.addEventListener('input', () => {
        voicesByModel[model.id] = input.value;
        saveForm();
        refreshPreview();
      });
      group.append(input);
    } else {
      const options = document.createElement('div');
      options.className = 'voice-options';
      const chosen = Array.isArray(voicesByModel[model.id]) ? voicesByModel[model.id] : [];
      for (const voice of model.voices) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = chosen.includes(voice);
        box.addEventListener('change', () => {
          const current = Array.isArray(voicesByModel[model.id]) ? voicesByModel[model.id] : [];
          voicesByModel[model.id] = box.checked
            ? [...current, voice]
            : current.filter((v) => v !== voice);
          saveForm();
          refreshPreview();
        });
        const text = document.createElement('span');
        text.textContent = voice;
        label.append(box, text);
        options.append(label);
      }
      group.append(options);
    }
    ui.voicePanel.append(group);
  }
}

function renderParams() {
  ui.params.replaceChildren();
  const tunables = [...new Set(selectedModels().flatMap((m) => m.tunables))].sort();
  if (tunables.length === 0) {
    ui.params.textContent = 'No tunable parameters for the selected models.';
    return;
  }
  for (const name of tunables) {
    const label = document.createElement('label');
    label.textContent = `${name} `;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = params[name] ?? '';
    input.addEventListener('input', () => {
      if (input.value === '') delete params[name];
      else params[name] = Number(input.value);
      saveForm();
      refreshPreview();
    });
    label.append(input);
    ui.params.append(label);
  }
}

async function renderTakes() {
  const takes = store.listTakes();
  ui.takeCount.textContent = `${takes.length} take${takes.length === 1 ? '' : 's'}`;
  ui.takes.replaceChildren();

  for (const take of takes) {
    let url = audioUrls.get(take.id);
    if (!url && take.status === 'ok') {
      const blob = await store.getAudio(take.id);
      if (blob) {
        url = URL.createObjectURL(blob);
        audioUrls.set(take.id, url);
      }
    }
    ui.takes.append(renderTake(take, { audioUrl: url, handlers }));
  }

  ui.storageUsage.textContent = `stored audio ${formatBytes(await store.audioUsage())} · `;
}

const handlers = {
  onDownload(take) {
    const url = audioUrls.get(take.id);
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    const ext = take.requestBody.response_format === 'pcm' ? 'pcm' : 'mp3';
    link.download = `${take.model.replace(/\//g, '-')}-${take.voice ?? 'default'}-${take.id.slice(0, 6)}.${ext}`;
    link.click();
  },
  onClone(take) {
    selectedModelIds = [take.model];
    voicesByModel = {};
    const model = catalog.find((m) => m.id === take.model);
    if (take.voice) voicesByModel[take.model] = model?.freeTextVoice ? take.voice : [take.voice];
    params = { ...take.params };
    ui.style.value = take.style ?? '';
    ui.text.value = take.text ?? '';
    ui.responseFormat.value = take.requestBody.response_format ?? 'mp3';
    renderModels();
    renderVoices();
    renderParams();
    saveForm();
    refreshPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  async onCopy(take) {
    await navigator.clipboard.writeText(JSON.stringify(take.requestBody, null, 2));
  },
  onFavourite(take) {
    store.updateTake(take.id, { favourite: !take.favourite });
    renderTakes();
  },
  async onRetry(take) {
    await runJobs([{ modelId: take.model, voice: take.voice, body: take.requestBody, take }]);
  },
  async onDelete(take) {
    const url = audioUrls.get(take.id);
    if (url) {
      URL.revokeObjectURL(url);
      audioUrls.delete(take.id);
    }
    await store.removeTake(take.id);
    renderTakes();
  },
};

async function runJobs(prepared) {
  const apiKey = store.getApiKey();
  if (!apiKey) {
    showBanner('Enter your OpenRouter API key first.');
    ui.apiKey.focus();
    return;
  }

  ui.generate.disabled = true;
  try {
    await runPool(prepared, CONCURRENCY, async (job) => {
      const result = await synthesize({ apiKey, body: job.body });
      const id = crypto.randomUUID();
      const take = {
        id,
        model: job.modelId,
        voice: job.voice,
        style: ui.style.value,
        text: ui.text.value,
        params: { ...params },
        requestBody: job.body,
        ts: Date.now(),
        favourite: false,
        status: result.error ? 'error' : 'ok',
        error: result.error ?? null,
      };
      store.addTake(take);
      if (result.blob) {
        const stored = await store.putAudio(id, result.blob);
        if (!stored.ok) showBanner(stored.message);
        audioUrls.set(id, URL.createObjectURL(result.blob));
      }
      if (result.error) reportError(result.error);
      await renderTakes();
    });
  } finally {
    refreshPreview();
  }
}

function reportError(error) {
  if (error.code === 401) {
    showBanner('The API key was rejected. Check it and save again.');
    ui.apiKey.focus();
  } else if (error.code === 402) {
    showBanner('Out of credits. Top up at openrouter.ai/credits.');
  } else if (error.code === 429) {
    showBanner('Rate limited. Retry the failed takes in a moment.');
  } else if (error.code === 502) {
    showBanner('The provider returned 502. This is usually transient — use retry.');
  } else {
    showBanner(`${error.code}: ${error.message}`);
  }
}

async function generate() {
  clearBanner();
  const overrides = parseOverrides();
  if (overrides.error) {
    showBanner(overrides.error);
    return;
  }
  const prepared = currentJobs().map((job) => ({
    modelId: job.model.id,
    voice: job.voice,
    body: buildRequest({
      model: job.model,
      voice: job.voice,
      text: ui.text.value,
      style: ui.style.value,
      params,
      responseFormat: ui.responseFormat.value,
      rawOverrides: overrides.value,
    }),
  }));
  await runJobs(prepared);
}

async function refreshCatalog({ force = false } = {}) {
  const cached = store.getCatalog();
  if (cached && !force) {
    catalog = cached;
    ui.catalogStatus.textContent = `${catalog.length} models (cached)`;
  } else {
    ui.catalogStatus.textContent = 'loading…';
    try {
      catalog = await loadCatalog();
      store.setCatalog(catalog);
      ui.catalogStatus.textContent = `${catalog.length} models`;
    } catch (cause) {
      ui.catalogStatus.textContent = 'failed';
      showBanner(`Could not load the model catalog: ${cause.message}`);
      return;
    }
  }
  renderModels();
  renderVoices();
  renderParams();
  refreshPreview();
}

function restoreForm() {
  const form = store.getForm();
  selectedModelIds = form.selectedModelIds ?? [];
  voicesByModel = form.voicesByModel ?? {};
  params = form.params ?? {};
  ui.style.value = form.style ?? '';
  ui.text.value = form.text ?? '';
  ui.responseFormat.value = form.responseFormat ?? 'mp3';
  ui.rawOverrides.value = form.rawOverrides ?? '';
  ui.apiKey.value = store.getApiKey();
}

ui.saveKey.addEventListener('click', () => {
  store.setApiKey(ui.apiKey.value.trim());
  clearBanner();
  ui.saveKey.textContent = 'Saved';
  setTimeout(() => { ui.saveKey.textContent = 'Save key'; }, 1200);
});

ui.refreshCatalog.addEventListener('click', () => refreshCatalog({ force: true }));
ui.generate.addEventListener('click', generate);

for (const field of [ui.style, ui.text, ui.rawOverrides, ui.responseFormat]) {
  field.addEventListener('input', () => { saveForm(); refreshPreview(); });
}

ui.clearAudio.addEventListener('click', async () => {
  await store.clearAudio();
  for (const url of audioUrls.values()) URL.revokeObjectURL(url);
  audioUrls.clear();
  await renderTakes();
});

restoreForm();
await refreshCatalog();
await renderTakes();
```

- [ ] **Step 2: Verify the tests still pass**

Run: `npm test`
Expected: PASS, 69 tests. `main.js` has no tests of its own — its logic lives in the modules above.

- [ ] **Step 3: Verify the page loads without console errors**

Run: `python3 -m http.server 8080`, open `http://localhost:8080`, open devtools.
Expected: the model list fills with 19 models and the console is clean. No key is needed for the catalog.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat: wire the playground together"
```

---

### Task 11: Manual verification and README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the whole app.
- Produces: nothing code depends on.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, 69 tests, no failures.

- [ ] **Step 2: Work the manual checklist**

Serve with `python3 -m http.server 8080` and confirm each of these. Record the actual result — do not mark this step done from expectation alone.

1. Paste a real key, click Save key. Reload. The key is still in the field.
2. Select `x-ai/grok-voice-tts-1.0`, tick voices `rex` and `leo`. The cost line reads `2 takes, about …`.
3. Enter text, click Generate. Two take cards appear, each with a working player.
4. Select `fish-audio/s1` as well. Its voice control is a free-text box, not an empty dropdown.
5. Type `speaker_a, speaker_b` in that box. The cost line count rises by two.
6. Open Request preview. It shows the body for the first job, and it changes as you edit the style field.
7. Put `{"provider":{"style":"newscast"}}` in the raw overrides. It appears in the preview.
8. Put `{ broken` in the raw overrides. Generate is disabled and the preview shows the parse error.
9. Deselect all voices for a model and generate. One take runs with no `voice` field in its body.
10. Click `clone to form` on an old take. The form matches that take.
11. Click `copy JSON` and paste elsewhere. It is the exact request body.
12. Click `★`. Reload. The favourite is still set.
13. **Reload the page. Past takes still play** — this is the IndexedDB path.
14. Note the `stored audio N KB` figure. Click `clear stored audio`. It drops to `0 B` and take cards now read `audio not stored`.
15. Save a deliberately wrong key and generate. A banner says the key was rejected, and the take card shows the 401 with a retry button.
16. Restore the good key and click retry on that failed take. It succeeds.
17. Click `delete` on a take. It disappears and stays gone after a reload.

- [ ] **Step 3: Write `README.md`**

```markdown
# OpenRouter TTS Playground

A static page for auditioning OpenRouter text-to-speech models and voices, so
you can find narration and character voices to reuse in other projects. Every
result carries the exact request that produced it, copyable as JSON.

## Run

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080> and paste an OpenRouter API key.

Serving over http matters: ES modules do not load from `file://`, and
localStorage is scoped per origin, so use the same port each time.

## Test

```sh
npm test
```

No dependencies, no build step. `package.json` exists only for ES module
resolution and the test script.

## How it works

The browser calls OpenRouter directly — no proxy, because the API serves
`access-control-allow-origin: *`. The model catalog comes from
`/api/v1/models?output_modalities=speech`, which needs no auth and supplies each
model's voices and supported parameters. Synthesis goes to
`/api/v1/audio/speech`, which returns raw audio bytes.

Select several models and voices to fan out: one Generate produces one take per
`(model, voice)` pair, three at a time. Style text is prepended to the input,
which is the mechanism Gemini and Fish Audio already use for their inline tags.
Anything provider-specific goes in the raw JSON override box, which is merged
into the request body last and always wins.

Config and take records live in localStorage; audio blobs live in IndexedDB, so
past takes replay after a reload without spending another request.

## Caveats

The API key is held in localStorage in plaintext. That is fine for a local
single-user tool, and it is why this should not be deployed anywhere public.

Cost figures are estimates. OpenRouter's `prompt` rate is per character for the
per-character TTS providers, but the basis is not uniform across models.

See `AGENTS.md` for conventions and `docs/superpowers/specs/` for the design.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with run, test and design notes"
```

---

## Hand verification still owed

Everything below needs a real browser and a real API key. Neither was available
during execution — the machine has no browser, and `libglib-2.0` is absent so
Playwright's Chromium cannot launch — so **`js/main.js` has never run in a DOM
and `createIdbAudioStore` has never touched a real IndexedDB.** Task 11's
17-point checklist above is the core of this; the reviews added these:

- **A `pcm` take.** `synthesize` rejects any success response whose content-type
  does not start with `audio/`. If OpenRouter answers PCM with
  `application/octet-stream`, every pcm take fails as `unexpected-type` with no
  workaround, since the guard is deliberately not overridable. Never live-tested.
- **IndexedDB commit semantics.** Writes now resolve in `transaction.oncomplete`
  rather than on request success, so a quota abort is caught rather than
  swallowed. Fill the quota and confirm the banner appears and no orphaned blob
  is left behind.
- **IndexedDB open-failure retry.** Block the first `indexedDB.open()`, confirm
  the error surfaces, then confirm a later call retries instead of staying wedged.
- **Clone round-trip through the override box.** Generate a take with
  `{"provider":{"style":"newscast"}}`, clear the box, clone the take, and confirm
  the box is restored and the preview matches the original request.
- **The API-key row.** Its label and flex layout were changed but never rendered.

## Corrections found during execution

The reference code in this plan had five defects, all caught by task review and
fixed in the shipped implementation. Recorded here so the plan does not mislead
anyone who reads it later. The shipped code in `js/` is correct; these code
blocks above are not.

1. **Task 1 — the test command.** `node --test test/` fails with
   MODULE_NOT_FOUND on Node 26. `package.json` uses bare `node --test`, which
   discovers `test/*.test.js` correctly.
2. **Task 4 — `cost.js` fails its own test.** `0.000015 * 500` evaluates to
   `0.007500000000000001`, not `0.0075`, so `assert.equal(estimateCost(grok,
   500), 0.0075)` fails against the code as written. Both `estimateCost` and
   `estimateTotal` round with `Math.round(x * 1e10) / 1e10`.
3. **Task 6 — `tts.js` could throw.** `await res.blob()` on the success path was
   unguarded, so a mid-download failure rejected out of `synthesize`, breaking
   the never-throws contract Task 5's pool depends on. It is wrapped, returning
   `{ error: { code: 'network' } }`.
4. **Task 7 — `store.js` wedged on a failed open.** `dbPromise ??= openDb()`
   caches a *rejected* promise, so one failed `indexedDB.open()` disabled audio
   storage for the rest of the session with no retry. The cache now clears
   itself on rejection while still propagating the error.
5. **Task 10 — the worker read live UI state.** The take record was built from
   `ui.text.value` / `ui.style.value` / `params` *after* the await, so a retried
   take, or any take in a batch during which the form was edited, recorded a
   config that was never sent — defeating the design's central promise that a
   take carries the exact request that produced it. Those values are captured
   into each job at click time, and retry reads them from the original take.
   Separately, concurrent `renderTakes()` calls were serialized through a
   promise chain; interleaved `replaceChildren()`/append produced duplicate and
   missing cards.

Test counts in the task steps read one lower than reality from Task 4 onward,
because correction 2 added a test. The suite finishes at **71**, not 69.

## Self-Review

**Spec coverage:**

| spec requirement | task |
|---|---|
| Static page, no server, CORS verified | Task 8, Task 10, README |
| Catalog from `?output_modalities=speech`, no auth | Task 3 |
| `supported_voices: null` → free text | Task 3, Task 10 (`renderVoices`) |
| Param whitelist, junk params dropped | Task 1, Task 3 |
| Take shape with `requestBody` verbatim | Task 7, Task 10 |
| Multi-select model and voice | Task 10 |
| Fan-out rules — voices pair with owning model, comma split, no voice → one job | Task 2 |
| Style prepended to text | Task 1 |
| Raw JSON overrides merged last | Task 1, Task 10 |
| Request preview panel | Task 8, Task 10 |
| Take log newest first, player, download, clone, copy JSON, favourite | Task 7, Task 9, Task 10 |
| localStorage for config, IndexedDB for blobs | Task 7 |
| Quota handling, clear-stored-audio control | Task 7, Task 10 |
| `ok` **and** `content-type` guard | Task 6 |
| 401 / 402 / 429 / 502 handling, retry on card | Task 6, Task 9, Task 10 |
| Failed take still appears with config and error | Task 9, Task 10 |
| Cost estimate before fan-out, labelled an estimate | Task 4, Task 10, README |
| Concurrency cap of 3 | Task 5, Task 10 |
| Unit tests for request, models, cost | Tasks 1–4 |
| Manual checks for DOM, IndexedDB, quota | Task 11 |
| Live smoke test run by hand | Task 11 steps 2.3 and 2.15 |
| Non-goals excluded | no task builds streaming, cloning, waveforms, SSML, trimming, or a server |
| Key in localStorage, not committed | Task 7, README, existing `.gitignore` |

No gaps.

**Placeholder scan:** No TBD, TODO, "similar to Task N", or "add error handling" steps. Every code step carries complete code.

**Type consistency:**
- `model` is the normalized shape from Task 3 everywhere. Task 1 reads only `.id` and `.supported_parameters`, both present in that shape.
- `expandJobs` returns `{ model, voice }` — Task 4's `estimateTotal` reads `job.model`, Task 10 maps it to `{ modelId, voice, body }` before `runJobs`. Consistent.
- `synthesize` returns `{ blob, generationId }` or `{ error: { code, message } }`. Task 9 reads `take.error.code` and `take.error.message`; Task 10 sets `error: result.error ?? null`. Consistent.
- Take field names match across Tasks 7, 9 and 10: `id`, `model`, `voice`, `style`, `text`, `params`, `requestBody`, `ts`, `favourite`, `status`, `error`.
- Store methods called in Task 10 — `getApiKey`, `setApiKey`, `getForm`, `setForm`, `getCatalog`, `setCatalog`, `listTakes`, `addTake`, `updateTake`, `removeTake`, `putAudio`, `getAudio`, `clearAudio`, `audioUsage` — all exist in Task 7.
- Element ids in Task 10's `ui` map all exist in Task 8's markup.
- `formatBytes` and `renderTake` are imported from `js/takes.js` in Task 10 and exported in Task 9. `formatTime` is used internally by `renderTake` only.
