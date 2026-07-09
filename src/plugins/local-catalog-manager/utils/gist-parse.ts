// Parse a GitHub Gist id from a raw URL, share URL, or bare hex id.

export function parseGistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
  const m = trimmed.match(
    /gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]+)/i,
  );
  return m ? m[1] : null;
}
