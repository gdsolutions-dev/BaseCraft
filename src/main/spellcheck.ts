// Home › Spelling (C2): the dictionary of the interface language, among the languages Chromium's spell checker offers.
const DEFAULT_REGION: Record<string, string> = { en: 'en-US', pt: 'pt-BR' };

/** The language to check with: the interface language of the user's region (fr-CH), else its default, else the first one of it. */
export function pickSpellLanguage(available: readonly string[], ui: string, region: string): string | null {
  const ofUi = available.filter((a) => a === ui || a.startsWith(`${ui}-`));
  const country = region.split('-')[1];
  return ofUi.find((a) => a === `${ui}-${country}`) ?? ofUi.find((a) => a === ui || a === DEFAULT_REGION[ui]) ?? ofUi[0] ?? null;
}
