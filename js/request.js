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

/** The raw JSON override box, validated. Returns `{ value }` on success and
 *  `{ error }` on failure -- never both, never neither. Only a JSON *object*
 *  is accepted: the value is deep-merged into the request body, which arrays
 *  and scalars cannot be. */
export function parseOverrides(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { value: {} };
  try {
    const value = JSON.parse(trimmed);
    if (!isPlainObject(value)) return { error: 'Overrides must be a JSON object.' };
    return { value };
  } catch (cause) {
    return { error: `Overrides are not valid JSON: ${cause.message}` };
  }
}

/** The exact `input` string buildRequest will send, so callers that need its
 *  length (the cost estimate) count what is actually sent, style included. */
export function composeInput(style, text) {
  const trimmedStyle = (style ?? '').trim();
  return trimmedStyle ? `${trimmedStyle}\n\n${text}` : text;
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
  const body = {
    model: model.id,
    input: composeInput(style, text),
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
