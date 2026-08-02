/** Sample scripts for auditioning voices.
 *
 *  Each entry targets a delivery a voice might be cast for, so cycling through
 *  the library exercises range rather than repeating one register. Kept short:
 *  most providers bill per character, and a fan-out multiplies that by the
 *  number of takes. */
export const PHRASES = [
  {
    name: 'Lighthouse · narration',
    text: 'The old lighthouse had not been lit in forty years, and the village had long stopped expecting it to be. Then, one October evening, the beam swept the water again.',
  },
  {
    name: 'Ransom demand · menace',
    text: 'You will bring the bag to the pier. You will come alone. And you will not, under any circumstances, speak to anyone before Thursday.',
  },
  {
    name: 'Bedtime story · warmth',
    text: 'Close your eyes now. The rain is on the roof, the door is locked, and nothing out there is looking for you. Sleep well, little one.',
  },
  {
    name: 'Match point · high energy',
    text: 'He serves — and it is in! What a moment, what an absolute moment! Nobody in this stadium saw that coming!',
  },
  {
    name: 'Diction test · hard consonants',
    text: 'On 14 March 1997, Dr. Vasquez transferred $14.50 to account 8821-B via NASA’s FTP server, then requested a PDF receipt.',
  },
  {
    name: 'Bad news · restraint',
    text: 'I need you to sit down. There has been an accident. She is stable, and the doctors are with her now, but I think you should come.',
  },
  {
    name: 'Sales pitch · bright',
    text: 'Here is the best part: it sets up in under a minute, it works with everything you already own, and if you do not love it, we will take it back.',
  },
  {
    name: 'Question ladder · prosody',
    text: 'So that is the plan. That is the plan? That is the plan! Right — who wants to tell him?',
  },
];

/** Returns the phrase after `index`, wrapping at the end.
 *
 *  Tolerates a missing, non-integer, or out-of-range index, because the current
 *  index is restored from localStorage and the library can shrink between
 *  sessions. Absent or unusable input starts at the first phrase. */
export function nextPhrase(index) {
  const count = PHRASES.length;
  const current = Number.isInteger(index) ? index : -1;
  const next = (((current + 1) % count) + count) % count;
  return { index: next, ...PHRASES[next] };
}
