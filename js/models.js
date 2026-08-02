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
