/** URL-safe slug: "Brighton & Hove Albion FC" -> "brighton-hove-albion". */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/&/g, ' ')
      .replace(/\b(fc|afc|cf)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'team'
  );
}

export function matchSlug(homeSlug: string, awaySlug: string, kickoffAt: Date): string {
  return `${homeSlug}-vs-${awaySlug}-${kickoffAt.toISOString().slice(0, 10)}`;
}

/** First slug not in `taken`: base, base-2, base-3 ... */
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}
