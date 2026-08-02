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
