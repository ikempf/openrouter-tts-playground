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

  let blob;
  try {
    blob = await res.blob();
  } catch (cause) {
    return { error: { code: 'network', message: cause.message } };
  }

  return {
    blob,
    generationId: res.headers.get('x-generation-id'),
  };
}
