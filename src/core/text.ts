/**
 * Gives a newly captured title a sentence-like start without damaging intentional
 * casing such as iPhone, eBay, or an acronym. Leading digits and punctuation are
 * also left alone.
 */
export function capitalizeNewTitle(value: string): string {
  const title = value.trim();
  const firstWord = title.match(/^\S+/)?.[0] ?? '';
  if (!/^[a-z]/.test(firstWord) || /[A-Z]/.test(firstWord.slice(1))) return title;
  return `${title[0]?.toUpperCase() ?? ''}${title.slice(1)}`;
}
