import { buildRequest, composeInput, expandJobs, parseOverrides } from './request.js';
import { PHRASES, nextPhrase } from './phrases.js';
import { createTake } from './take.js';
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
  phraseCycle: el('phrase-cycle'),
  phraseName: el('phrase-name'),
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
let phraseIndex = null;
const audioUrls = new Map();

// renderTakes() does `ui.takes.replaceChildren()` and then appends inside a
// loop containing `await store.getAudio(...)`. With CONCURRENCY = 3, up to
// three workers can each call renderTakes() around the same time; without
// serialization, one call's replaceChildren() can land in the middle of
// another's append loop, producing duplicate or missing take cards. Queue
// every call onto a single chain so renders still happen one per completed
// job (takes still appear as they finish) but never interleave.
let renderChain = Promise.resolve();
function scheduleRenderTakes() {
  const run = () => renderTakes();
  renderChain = renderChain.then(run, run);
  return renderChain;
}

function showBanner(message) {
  ui.banner.textContent = message;
  ui.banner.hidden = false;
}

function clearBanner() {
  ui.banner.hidden = true;
}

const selectedModels = () => catalog.filter((m) => selectedModelIds.includes(m.id));

const currentOverrides = () => parseOverrides(ui.rawOverrides.value);

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
    phraseIndex,
  });
}

function refreshPreview() {
  const jobs = currentJobs();
  const overrides = currentOverrides();

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

  // Bill against what is actually sent: buildRequest prepends the style to
  // the text, so counting ui.text alone understates every styled request.
  const cost = estimateTotal(jobs, composeInput(ui.style.value, ui.text.value).length);
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

  // store.getAudio/audioUsage are backed by IndexedDB and, unlike the rest of
  // this app's storage calls, can reject (a broken/blocked database). This
  // function runs inside the runPool worker (via runJobs), whose contract is
  // "never throw" — an uncaught rejection here would abort unrelated
  // in-flight synthesis jobs. Degrade to the take card's existing no-audio
  // state instead, and surface one banner for the whole refresh rather than
  // one per affected take.
  let audioStoreFailed = false;

  for (const take of takes) {
    let url = audioUrls.get(take.id);
    if (!url && take.status === 'ok') {
      let blob = null;
      try {
        blob = await store.getAudio(take.id);
      } catch {
        audioStoreFailed = true;
      }
      if (blob) {
        url = URL.createObjectURL(blob);
        audioUrls.set(take.id, url);
      }
    }
    ui.takes.append(renderTake(take, { audioUrl: url, handlers }));
  }

  let usage = 0;
  try {
    usage = await store.audioUsage();
  } catch {
    audioStoreFailed = true;
  }
  ui.storageUsage.textContent = `stored audio ${formatBytes(usage)} · `;

  if (audioStoreFailed) {
    showBanner("Could not read this browser's stored audio. Affected takes show without a player.");
  }
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
    // Overrides win over everything buildRequest generates, so restoring the
    // rest of the form without them would clone a materially different
    // request under the same label. Takes recorded before the field existed
    // clear the box rather than leaving whatever is in it now.
    const overrides = take.rawOverrides ?? {};
    ui.rawOverrides.value = Object.keys(overrides).length
      ? JSON.stringify(overrides, null, 2)
      : '';
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
    scheduleRenderTakes();
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
    scheduleRenderTakes();
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
  let saveFailed = false;
  try {
    await runPool(prepared, CONCURRENCY, async (job) => {
      const result = await synthesize({ apiKey, body: job.body });
      const id = crypto.randomUUID();
      const take = createTake({ job, result, id });

      let blobPersisted = false;
      if (result.blob) {
        const stored = await store.putAudio(id, result.blob);
        if (!stored.ok) showBanner(stored.message);
        blobPersisted = stored.ok;
      }

      // store.addTake writes the whole take list back to localStorage and,
      // unlike putAudio, can throw synchronously (e.g. QuotaExceededError)
      // when storage is full. An uncaught throw here would escape this
      // async worker and abort unrelated in-flight jobs via runPool's
      // Promise.all -- guard it the same way putAudio's own contract
      // already guards IndexedDB failures.
      let recordSaved = true;
      try {
        store.addTake(take);
      } catch {
        recordSaved = false;
        saveFailed = true;
      }

      if (recordSaved) {
        if (result.blob) audioUrls.set(id, URL.createObjectURL(result.blob));
        if (result.error) reportError(result.error);
      } else if (blobPersisted) {
        // No take record exists to reach this blob, so leaving it in
        // IndexedDB would orphan it: quota spent on audio no take card can
        // ever reach or delete. store.removeTake is safe to call even
        // though the record was never added -- it filters the (unaffected)
        // take list and unconditionally removes any audio stored under
        // this id. It is itself another localStorage write (plus an
        // IndexedDB delete), so it inherits the very failure mode this
        // block exists to guard against -- best-effort only, and must not
        // throw either: the storage-full banner below already tells the
        // user what happened.
        try {
          await store.removeTake(id);
        } catch {
          // Cleanup failed too; nothing further to do here.
        }
      }

      await scheduleRenderTakes();
    });
    if (saveFailed) {
      showBanner('Could not save the take — browser storage is full. Delete some takes or clear stored audio.');
    }
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
  const overrides = currentOverrides();
  if (overrides.error) {
    showBanner(overrides.error);
    return;
  }
  // Capture the form once, at click time, and carry it on every prepared
  // job. The worker runs after `await synthesize(...)`, seconds later, by
  // which point the user may have already edited style/text/params or the
  // override box for the next batch -- reading ui.*.value or the live
  // `params` object from inside the worker would record what the form says
  // *now*, not what was actually sent for this job.
  const style = ui.style.value;
  const text = ui.text.value;
  const paramsSnapshot = { ...params };
  const prepared = currentJobs().map((job) => ({
    modelId: job.model.id,
    voice: job.voice,
    style,
    text,
    params: paramsSnapshot,
    rawOverrides: overrides.value,
    body: buildRequest({
      model: job.model,
      voice: job.voice,
      text,
      style,
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
  // The label is derived, not stored: the library can change between
  // sessions, so a persisted name could outlive the phrase it named.
  phraseIndex = Number.isInteger(form.phraseIndex) && PHRASES[form.phraseIndex]
    ? form.phraseIndex
    : null;
  ui.phraseName.textContent = phraseIndex === null ? '' : phraseLabel(phraseIndex);
  ui.apiKey.value = store.getApiKey();
}

function phraseLabel(index) {
  return `${PHRASES[index].name} · ${index + 1}/${PHRASES.length}`;
}

function loadNextPhrase() {
  const phrase = nextPhrase(phraseIndex);
  phraseIndex = phrase.index;
  ui.text.value = phrase.text;
  ui.phraseName.textContent = phraseLabel(phrase.index);
  saveForm();
  refreshPreview();
}

ui.phraseCycle.addEventListener('click', loadNextPhrase);

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
  await scheduleRenderTakes();
});

restoreForm();
await refreshCatalog();
await scheduleRenderTakes();
