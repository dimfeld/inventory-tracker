/**
 * Split search text into terms that must all match. Each word is a term, and text in double
 * quotes is one term, so `m5 8mm` finds "M5 x 8mm" but `"m5 x 8"` needs those words together.
 * A quote without a closing quote runs to the end of the text.
 */
export function searchTerms(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"?|([^\s"]+)/g)]
    .map((match) => (match[1] ?? match[2]).trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** Whether the text contains every term of the query, ignoring case. */
export function matchesSearch(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return searchTerms(query).every((term) => haystack.includes(term.toLowerCase()));
}
