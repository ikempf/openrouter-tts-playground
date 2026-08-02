import { PHRASES } from './phrases.js';

/** Direction presets: a style, the two parameters most worth varying, and the
 *  script that shows the direction off.
 *
 *  A preset names its phrase rather than indexing it, so reordering the phrase
 *  library cannot silently repoint a preset at the wrong script. A test asserts
 *  every one of these names resolves. */
export const PRESETS = [
  {
    name: 'Documentary',
    style: '(calm, measured, unhurried)',
    params: { temperature: 0.6, top_p: 0.9 },
    phrase: 'Lighthouse · narration',
  },
  {
    name: 'Villain',
    style: '(cold, controlled, quietly menacing)',
    params: { temperature: 0.9, top_p: 0.95 },
    phrase: 'Ransom demand · menace',
  },
  {
    name: 'Bedtime',
    style: '(soft, close, gentle)',
    params: { temperature: 0.5, top_p: 0.85 },
    phrase: 'Bedtime story · warmth',
  },
  {
    name: 'Commentary',
    style: '(fast, excited, rising)',
    params: { temperature: 1.0, top_p: 0.95 },
    phrase: 'Match point · high energy',
  },
  {
    name: 'Announcer',
    style: '(crisp, clear, deliberate)',
    params: { temperature: 0.3, top_p: 0.8 },
    phrase: 'Diction test · hard consonants',
  },
  {
    name: 'Confidant',
    style: '(quiet, careful, holding back)',
    params: { temperature: 0.7, top_p: 0.9 },
    phrase: 'Bad news · restraint',
  },
];

/** Looks a phrase up by name.
 *
 *  Reports `phraseIndex: null` and omits `text` when the name is unknown, so a
 *  broken reference leaves the textarea alone rather than blanking it. */
export function resolvePhrase(name) {
  const phraseIndex = PHRASES.findIndex((phrase) => phrase.name === name);
  if (phraseIndex < 0) return { phraseIndex: null };
  const phrase = PHRASES[phraseIndex];
  return { phraseIndex, phraseName: phrase.name, text: phrase.text };
}

/** Returns the preset after `index`, wrapping at the end, with its phrase
 *  resolved so the text cycler can resume from there rather than restarting.
 *
 *  Tolerates a missing, non-integer, or out-of-range index for the same reason
 *  `nextPhrase` does: the index is restored from localStorage. */
export function nextPreset(index) {
  const count = PRESETS.length;
  const current = Number.isInteger(index) ? index : -1;
  const next = (((current + 1) % count) + count) % count;
  const preset = PRESETS[next];
  return {
    index: next,
    name: preset.name,
    style: preset.style,
    params: { ...preset.params },
    ...resolvePhrase(preset.phrase),
  };
}
