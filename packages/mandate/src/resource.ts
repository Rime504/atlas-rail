/**
 * Resource matching for `scope.allowedResources`.
 *
 * Patterns are `<origin><path>` where the path is either exact or ends in `/*` (prefix match on a
 * path-segment boundary). Matching is fail-closed: anything that does not parse, carries
 * credentials, or is not http(s) never matches.
 *
 * URLs are normalised with the WHATWG parser first, which resolves dot-segments (including
 * percent-encoded ones), lowercases the host, strips default ports and converts backslashes. That
 * is what defeats `/research/../inference`, `%2e%2e`, `HOST:80` and similar tricks. Query strings
 * and fragments never participate in matching.
 */

export interface ResourceKey {
  origin: string;
  pathname: string;
}

export function normalizeResourceUrl(input: string): ResourceKey | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  // An encoded slash or backslash inside a segment is ambiguous between origin servers and proxies.
  if (/%2f|%5c/i.test(url.pathname)) return null;
  return { origin: url.origin, pathname: url.pathname };
}

export interface ParsedPattern {
  origin: string;
  path: string;
  prefix: boolean;
}

/** Parses a mandate resource pattern; returns null if the pattern itself is malformed. */
export function parseResourcePattern(pattern: string): ParsedPattern | null {
  if (pattern.length === 0 || pattern.length > 2048) return null;
  const wildcardCount = (pattern.match(/\*/g) ?? []).length;
  const prefix = pattern.endsWith('/*');
  if (wildcardCount > 1 || (wildcardCount === 1 && !prefix)) return null;

  const base = prefix ? pattern.slice(0, -1) : pattern; // keep the trailing slash for prefix patterns
  if (/[?#]/.test(base)) return null;
  const key = normalizeResourceUrl(base);
  if (!key) return null;
  return { origin: key.origin, path: key.pathname, prefix };
}

export function matchesResourcePattern(resourceUrl: string, pattern: string): boolean {
  const resource = normalizeResourceUrl(resourceUrl);
  const parsed = parseResourcePattern(pattern);
  if (!resource || !parsed) return false;
  if (resource.origin !== parsed.origin) return false;
  if (parsed.prefix) {
    // `/research/*` -> prefix `/research/`; `/research` and `/researchX` do not match.
    return (
      resource.pathname.startsWith(parsed.path) &&
      (parsed.path === '/' || resource.pathname.length > parsed.path.length)
    );
  }
  return resource.pathname === parsed.path;
}

export function matchesAnyResourcePattern(resourceUrl: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesResourcePattern(resourceUrl, pattern));
}
