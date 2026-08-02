# OpenRouter TTS Playground — Design

Date: 2026-08-02

## Purpose

A local static page for auditioning OpenRouter text-to-speech models to find
narration and character voices for use in other projects.

Two things it must support equally well:

- **Cross-model comparison** — send one script to several models and voices, hear
  them next to each other.
- **Single-model dial-in** — hold a model fixed and iterate on voice, style, and
  parameters, comparing each attempt against the last.

The output of a session is a **configuration worth reusing**, not an audio file.
Every result therefore carries the exact request that produced it, copyable as
JSON.

## Feasibility

A static page is sufficient. No proxy or server component is needed. Verified
against the live API on 2026-08-02:

```
OPTIONS /api/v1/audio/speech   → 204, access-control-allow-origin: *
GET     /api/v1/models         → 200, access-control-allow-origin: *
```

`Authorization` and `Content-Type` both appear in `access-control-allow-headers`,
so the preflight passes and the browser may call the API directly. The speech
endpoint returns raw audio bytes, which become a blob URL for an `<audio>`
element.

## API surface used

| endpoint | purpose | auth |
|---|---|---|
| `GET /api/v1/models?output_modalities=speech` | model catalog (19 models) | none |
| `GET /api/v1/models/{id}/endpoints` | per-provider parameter support | none |
| `POST /api/v1/audio/speech` | synthesis | Bearer key |

Each catalog entry supplies `id`, `name`, `pricing`, `supported_voices` and
`supported_parameters`. Per-model inputs are therefore derivable from the API
immediately; they are not deferred work.

Two properties of this data shape the design:

1. `supported_voices` is `null` for some models (Fish Audio, MiniMax). The voice
   input degrades to free text rather than rendering an empty dropdown.
2. `supported_parameters` includes parameters meaningless for speech — Grok
   reports `logprobs`, `top_logprobs`, `stop`, `frequency_penalty`. Rendering
   the list verbatim would produce a wall of junk controls.

Request body:

```json
{
  "model": "x-ai/grok-voice-tts-1.0",
  "input": "The old lighthouse had not been lit in forty years.",
  "voice": "rex",
  "response_format": "mp3",
  "temperature": 0.7
}
```

## The take

The unit of work is a **take**: one synthesis attempt with everything needed to
understand and reproduce it.

```js
{
  id,            // uuid, also the IndexedDB blob key
  model,         // "x-ai/grok-voice-tts-1.0"
  voice,         // "rex", or null when the provider default was used
  style,         // the style text as typed
  text,          // the script as typed
  params,        // { temperature: 0.7, seed: 42 }
  rawOverrides,  // the parsed override object, {} when the box was empty
  requestBody,   // the exact body sent, after overrides
  ts,
  favourite,     // boolean
  status,        // "ok" | "error"
  error          // { code, message } when status is "error"
}
```

`requestBody` is stored verbatim so a take is never ambiguous about what produced
its audio. This is what the copy-JSON action yields.

The form fields are kept alongside it because `requestBody` cannot be taken
apart again: style is inseparable from text once prepended, and an overridden
field is indistinguishable from a generated one. `rawOverrides` in particular
must be recorded, because overrides always win — cloning a take without them
would restore a materially different request under the same label. Records
written before this field existed read as `{}`.

The record is built by `js/take.js` as a pure mapping from `(job, result, id)`,
so the shape has one origin and is unit-tested.

## Interface

A single surface: a config form, and below it a log of takes, newest first.

```
┌─ Config ─────────────────────────────────┐
│ Model  [x-ai/grok-voice-tts-1.0    ▼] +  │
│ Voice  [rex ×] [leo ×] [+ add]           │
│ Style  [gravelly, unhurried............] │
│ temp ──●──── 0.7   seed [____] fmt [mp3] │
│ Text   [The old lighthouse had not...  ] │
│                            [ Generate ]  │
└──────────────────────────────────────────┘

  Takes (newest first)                4 takes
 ┌────────────────────────────────────────┐
 │ grok-voice-tts-1.0 · rex · t0.7   14:31│
 │ ▶ ━━━━━━━━●───────────── 0:07  ⬇ ⧉ 📋 ★│
 ├────────────────────────────────────────┤
 │ kokoro-82m · af_bella · t0.7      14:29│
 │ ▶ ━━━━━━━━━━━━━●──────── 0:08  ⬇ ⧉ 📋 ★│
 └────────────────────────────────────────┘
   ⬇ download   ⧉ clone to form
   📋 copy JSON config   ★ favourite
```

Model and voice are **multi-select**. One Generate fans out over the cross
product, so a systematic sweep needs no separate mode. `⧉ clone to form` pulls a
past take back into the form for tweaking, which is the dial-in loop.

### Fan-out rules

Voices belong to models, so the cross product is not a blind product of the two
selections:

- The voice picker lists the union of `supported_voices` across the selected
  models, each option labelled with its owning model.
- A job is created only for a `(model, voice)` pair where that voice belongs to
  that model. Selecting `grok:rex` and `kokoro:af_bella` produces two jobs, not
  four.
- For a model whose `supported_voices` is `null`, the picker shows a free-text
  field scoped to that model. It accepts a comma-separated list, so fan-out
  still works: `speaker_a, speaker_b` produces two jobs.
- Selecting a model but no voice for it produces one job for that model with
  `voice` omitted, letting the provider default apply.

### Sample phrases

A `↻` button beside the Text label loads the next entry from a small library
of sample scripts, wrapping at the end, with the phrase's name and position
shown alongside. The library exists so voices can be auditioned across a
spread of deliveries — calm narration, menace, warmth, high energy, a diction
stress-test of numbers and acronyms, restraint, brightness, and a question /
exclamation ladder for intonation — rather than judged on one register.

Clicking overwrites whatever is in the textarea, including typing in progress.
A guard that declined to overwrite edited text would silently do nothing and
read as a broken button.

The current index persists with the rest of the form state; the displayed name
is derived from it rather than stored, so a persisted label can never outlive
the phrase it named. The button is a **sibling** of the `<label for="text">`,
never a child — `<button>` is a labelable element, so nesting it would make
clicking the word "Text" fire the cycle.

Two collapsible panels sit under the form:

- **Raw request overrides (JSON)** — merged into the body last, always winning.
- **Request preview** — the exact body that Generate will send.

## Style steering

There is no universal `instructions` field on this endpoint. Style handling is
provider-specific: Gemini uses inline audio tags within the text, Fish Audio uses
parentheticals within the text, MAI-Voice-2 takes `provider.style` and
`provider.styledegree`, OpenAI forwards `instructions` through provider config,
and Grok and Kokoro take nothing.

The Style field is therefore **prepended to the text** — the mechanism that needs
no provider-specific support and already works for Gemini and Fish. Everything
else goes through the raw JSON override box.

No per-provider routing map is built. Such a map is inference about provider
behaviour, and when it is wrong the style silently does nothing with no way to
work around it. The override box is always truthful and always available.

## Modules

```
audio-playground/
  index.html
  css/app.css
  js/
    main.js       form state, fan-out, concurrency, wiring
    models.js     fetch + cache catalog, normalize voices, filter params
    request.js    PURE: build request body, parse overrides, expand jobs
    take.js       PURE: build the take record
    cost.js       PURE: estimate fan-out cost from model pricing
    pool.js       PURE: bounded-concurrency job runner
    phrases.js    PURE: the sample phrase library and its cycling
    tts.js        POST, distinguish audio from error
    store.js      localStorage + IndexedDB
    takes.js      render take cards
  test/
    request.test.js
    take.test.js
    phrases.test.js
    cost.test.js
    pool.test.js
    models.test.js
    store.test.js
    tts.test.js
    takes.test.js
```

| module | contract | depends on |
|---|---|---|
| `models.js` | `loadCatalog() → Model[]`; null voices become free-text mode; params intersected with the TTS whitelist | `request.js` (the whitelist) |
| `request.js` | `buildRequest(config) → body`, `expandJobs(selection) → job[]`, `parseOverrides(text) → {value}\|{error}`, `composeInput(style, text) → string`. No fetch, no DOM, no storage | — |
| `take.js` | `createTake({job, result, id}) → take`. Pure; reads no live UI state | — |
| `cost.js` | `estimateTotal(jobs, charCount) → usd`, `formatCost(usd) → string`. Pure | — |
| `pool.js` | `runPool(items, limit, worker)`, bounded concurrency, worker never throws | — |
| `phrases.js` | `PHRASES`, `nextPhrase(index) → { index, name, text }`. Pure; wraps and tolerates a stale index | — |
| `tts.js` | `synthesize(key, body) → {blob} \| {error}`; `fetch` injected | — |
| `store.js` | key/form/takes in localStorage, blobs in IndexedDB, quota handling; both stores injected | — |
| `takes.js` | `renderTake(take) → element` plus its actions, and the pure label/time/byte formatters | — |
| `main.js` | orchestration | all |

`request.js` holds the only logic worth testing, so it stays pure:

```js
buildRequest({ model, voice, text, style, params, rawOverrides })
  input  = style ? `${style}\n\n${text}` : text
  params = pick(params, WHITELIST ∩ model.supported_parameters)
  body   = { model, input, voice, response_format, ...params }
  return deepMerge(body, rawOverrides)   // overrides win
```

`WHITELIST` is `temperature`, `top_p`, `seed`, `speed`, `top_k`, `min_p`,
`repetition_penalty`. `response_format` is excluded because it is a first-class
body field set directly by the form, not an optional tunable.

## Data flow

```
boot ──▶ key from localStorage ──▶ GET /models?output_modalities=speech
                                        │
                                   cached in localStorage
                                        ▼
                              config form (model[] × voice[])
                                        │  Generate
                                        ▼
                            cross product → N jobs, max 3 in flight
                                        │
                            request.js ──▶ POST /audio/speech
                                        │
                        ┌───────────────┴───────────────┐
                     audio blob                    error JSON
                        │                               │
              IndexedDB + take card            take card with error
                        └───────────────┬───────────────┘
                                        ▼
                                   take log
```

## Persistence

- **localStorage** — API key, form state, catalog cache, take records including
  the favourite flag.
- **IndexedDB** — audio blobs keyed by take id, roughly 150 KB each. Past takes
  replay after a reload without spending another request.

Supporting work this implies: blob cleanup for old takes, a quota-exceeded path,
and a "clear stored audio (N MB)" control showing current usage.

## Error handling

A non-audio response still has a body, and writing that body to a `.mp3` yields a
file that looks like audio and is not. This project began from exactly that
mistake. The rules:

- Check `response.ok` **and** `content-type`. An `application/json` response is
  parsed as an error and never treated as audio.
- **401** — banner, focus the key field.
- **402** — banner linking to credits.
- **429**, **502** — retry button on the take card; provider 502s are transient.
- **400 invalid model or voice** — should be unreachable, since both come from
  the catalog rather than free typing.
- A failed take still appears in the log with its config, its error, and Retry.
  When surveying providers, failures are data.

Before a fan-out runs, an estimated cost is shown from `pricing.prompt × chars`
— twelve variants of a 500-character script on Grok is roughly $0.09. It is
labelled an estimate, because the per-token versus per-character basis is not
uniform across these models.

## Testing

Unit tests under `node --test`, no browser:

- `request.js` — style prepending, parameter filtering drops `logprobs`, override
  precedence, absent style leaves text untouched.
- `parseOverrides` — an object parses, an empty box means no overrides, malformed
  JSON reports rather than throws, arrays and scalars are rejected.
- `expandJobs` — voices pair only with their owning model, comma-separated
  free-text voices expand, a model with no voice selected yields one job.
- `phrases.js` — the library is non-empty with unique names, cycling advances
  and wraps, a stale or non-integer index falls back to the first phrase, and
  the returned object cannot mutate the library.
- `take.js` — the ok and error shapes, a retry sources the resent take, the
  record copies what it is given and reads no live state.
- `models.js` — `supported_voices: null` becomes free-text mode, whitelist
  intersection.
- Cost estimation, the job pool, `store.js` against an injected `localStorage`
  and an in-memory audio store, `tts.js` against an injected `fetch`, and
  `takes.js`'s formatters.

**Not yet verified — and these must be checked by hand before the tool is
trusted:** DOM wiring, IndexedDB persistence across a reload, and the
quota-exceeded path. `js/main.js` has never run in a browser and
`createIdbAudioStore` has never touched a real IndexedDB; `store.js` is tested
through an in-memory stand-in, which is not the same thing. Nothing in this
document should be read as a record that these work.

One live smoke test against the real API, run manually. It costs money and is
never part of an automated sweep.

## Non-goals

Streaming, voice cloning uploads, waveform display, an SSML editor, audio
trimming, multi-user support, and any server component.

## Security

The API key is held in localStorage in plaintext. This is acceptable for a local
single-user tool and is the reason the page must not be deployed publicly. No key
is ever committed.
