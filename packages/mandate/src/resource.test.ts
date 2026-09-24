import { describe, expect, it } from 'vitest';
import {
  matchesAnyResourcePattern,
  matchesResourcePattern,
  normalizeResourceUrl,
  parseResourcePattern,
} from './resource';

const P = 'http://localhost:4402/research/*';

describe('resource patterns', () => {
  it('matches paths under a /* prefix on a segment boundary', () => {
    expect(matchesResourcePattern('http://localhost:4402/research/summary', P)).toBe(true);
    expect(matchesResourcePattern('http://localhost:4402/research/a/b', P)).toBe(true);
    expect(matchesResourcePattern('http://localhost:4402/research/summary?q=1#frag', P)).toBe(true);
  });

  it('does not match siblings, the bare prefix, or other paths', () => {
    expect(matchesResourcePattern('http://localhost:4402/research', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/research/', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/researchX/summary', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/inference/heavy', P)).toBe(false);
  });

  it('matches exact patterns exactly', () => {
    const exact = 'http://localhost:4402/research/summary';
    expect(matchesResourcePattern('http://localhost:4402/research/summary', exact)).toBe(true);
    expect(matchesResourcePattern('http://localhost:4402/research/summary/x', exact)).toBe(false);
  });

  it('defeats dot-segment traversal, including percent-encoded dots', () => {
    expect(matchesResourcePattern('http://localhost:4402/research/../inference/heavy', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/research/%2e%2e/inference/heavy', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/research/%2E%2E/inference/heavy', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/research/./summary', P)).toBe(true);
  });

  it('rejects encoded slashes and backslash tricks as ambiguous', () => {
    expect(matchesResourcePattern('http://localhost:4402/research%2F..%2Finference', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4402/research/a%5Cb', P)).toBe(false);
  });

  it('requires the exact origin: host, port and scheme', () => {
    expect(matchesResourcePattern('http://localhost:4402.evil.com/research/summary', P)).toBe(false);
    expect(matchesResourcePattern('http://evil.com/research/summary', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost:4403/research/summary', P)).toBe(false);
    expect(matchesResourcePattern('https://localhost:4402/research/summary', P)).toBe(false);
    expect(matchesResourcePattern('http://localhost@evil.com/research/summary', P)).toBe(false);
  });

  it('rejects URLs carrying credentials and non-http schemes', () => {
    expect(normalizeResourceUrl('http://user:pass@localhost:4402/research/x')).toBeNull();
    expect(normalizeResourceUrl('ftp://localhost:4402/research/x')).toBeNull();
    expect(normalizeResourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeResourceUrl('not a url')).toBeNull();
  });

  it('normalises host case and default ports', () => {
    expect(matchesResourcePattern('http://LOCALHOST:4402/research/x', P)).toBe(true);
    expect(matchesResourcePattern('http://example.com:80/api/x', 'http://example.com/api/*')).toBe(true);
    expect(matchesResourcePattern('https://example.com:443/api/x', 'https://example.com/api/*')).toBe(true);
  });

  it('treats a root prefix pattern as origin-wide', () => {
    expect(matchesResourcePattern('http://localhost:4402/anything/at/all', 'http://localhost:4402/*')).toBe(true);
    expect(matchesResourcePattern('http://localhost:4402/', 'http://localhost:4402/*')).toBe(true);
  });

  it('rejects malformed patterns (interior wildcards, queries, junk) and never matches them', () => {
    const bad = [
      'http://localhost:4402/re*search/x',
      'http://localhost:4402/*/x',
      'http://localhost:4402/x?y=1',
      '',
      'localhost/research/*',
      '*',
    ];
    for (const pattern of bad) {
      expect(parseResourcePattern(pattern)).toBeNull();
      expect(matchesResourcePattern('http://localhost:4402/research/x', pattern)).toBe(false);
    }
  });

  it('matchesAny is false for an empty pattern list', () => {
    expect(matchesAnyResourcePattern('http://localhost:4402/research/x', [])).toBe(false);
    expect(
      matchesAnyResourcePattern('http://localhost:4402/inference/x', [P, 'http://localhost:4402/inference/*']),
    ).toBe(true);
  });
});
