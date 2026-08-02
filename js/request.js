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
