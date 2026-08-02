# AGENTS.md

## What this is

A local, static playground for auditioning OpenRouter TTS voices. The purpose is
finding good narration and character voices to reuse in other projects — so the
deliverable of a session with this tool is a **config you can copy elsewhere**,
not just an audio file.

## Running it

```sh
mise run serve                  # or: python3 -m http.server 8080
```

Then open <http://localhost:8080>. `mise.toml` pins Node (tests) and Python
(static server only) — those are the project's sole external tools.

An http origin is required — ES modules do not load over `file://`, and
localStorage is scoped per origin, so always use the same port.

## Testing

```sh
npm test        # node --test, which discovers test/*.test.js
```

Everything testable without a browser is unit-tested: request building and
override parsing (`request.js`), take-record construction (`take.js`), catalog
normalization (`models.js`), cost estimation, the job pool, the sample phrase
library and its cycling (`phrases.js`), the direction presets and the phrase
reference each one carries (`presets.js`), the storage layer against an injected
`localStorage` and in-memory audio store, `tts.js` against an injected `fetch`,
and `takes.js`'s pure formatters.

What is **not** covered, and what that means:

- `js/main.js` has no tests and has never run in a browser. It is DOM wiring
  only — anything in it worth testing should move to a module that is.
- `createIdbAudioStore` has never touched a real IndexedDB. `store.js` is tested
  through `createMemoryAudioStore`, which is a stand-in, not the thing.

So: **DOM wiring, IndexedDB persistence across a reload, and the quota-exceeded
path must be verified by hand, and have not been yet.** Do not read this section
as a record that they work.

A live smoke test against the real API costs money and is run manually, never in
a test sweep.

## Constraints

- **No dependencies, no build step, no bundler, no framework.** Vanilla ES
  modules. If something seems to need npm, it probably needs to not exist.
- **No server component.** The browser talks to OpenRouter directly.
- Keep modules small and single-purpose. `js/request.js` stays pure — no fetch,
  no DOM, no storage — because it holds the only logic worth testing.

## OpenRouter facts

Verified against the live API on 2026-08-02:

- `GET /api/v1/models?output_modalities=speech` — 19 TTS models. Needs **no auth**.
  Returns `supported_voices` and `supported_parameters` per model.
- `GET /api/v1/models/{id}/endpoints` — per-provider `supported_parameters`.
- `POST /api/v1/audio/speech` — body `{ model, input, voice, response_format,
  speed?, provider? }`. Returns **raw audio bytes**, not JSON.
- **CORS is open**: `access-control-allow-origin: *` on both, and `Authorization`
  + `Content-Type` are in `access-control-allow-headers`. Browser-direct calls
  work; no proxy needed.

### Two traps

1. **A non-audio response still has a body.** Errors come back as JSON with a
   200-shaped download. Always check `response.ok` *and* `content-type` before
   treating bytes as audio — writing an error body to a `.mp3` is how this
   project started.
2. **`supported_parameters` includes LLM junk.** Grok reports `logprobs`,
   `top_logprobs`, `stop`, `frequency_penalty`. Meaningless for narration.
   Render only the whitelist in `js/models.js`, intersected with what the model
   actually supports.

Some models report `supported_voices: null` (Fish Audio, MiniMax). The voice
field must degrade to free text rather than rendering an empty dropdown.

## Style steering

There is no universal `instructions` field. The Style input is prepended to the
text, which is the mechanism Gemini (inline audio tags) and Fish (parentheticals)
already use. Everything else goes through the raw JSON override box, which is
merged into the request body last and always wins. Do not build a per-provider
routing map — it guesses, and a wrong guess fails silently.

## Secrets

The API key lives in localStorage in plaintext. Acceptable for a local tool.
Never commit a key, and do not deploy this anywhere public.
