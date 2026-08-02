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
