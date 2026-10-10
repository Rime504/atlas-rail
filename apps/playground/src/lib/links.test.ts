import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYGROUND_URL, WEBSITE_URL } from './links';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('public links', () => {
  it('point at the real deployments', () => {
    expect(PLAYGROUND_URL).toBe('https://atlas-rail-playground.vercel.app');
    expect(WEBSITE_URL).toBe('https://atlas-rail-site.vercel.app');
  });

  it('no source file uses the dead atlasrail.dev domain (share previews used to point there)', () => {
    const offenders = sourceFiles(SRC).filter((file) => readFileSync(file, 'utf8').includes('atlasrail.dev'));
    expect(offenders).toEqual([]);
  });

  it('share previews resolve against the playground URL and have an image', () => {
    expect(readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')).toContain('metadataBase: new URL(PLAYGROUND_URL)');
    expect(existsSync(join(SRC, 'app', 'opengraph-image.png'))).toBe(true);
    expect(existsSync(join(SRC, 'app', 'twitter-image.png'))).toBe(true);
  });

  it('the landing page and the end screen link to the website', () => {
    for (const page of [join(SRC, 'app', 'page.tsx'), join(SRC, 'app', 'demo', 'page.tsx')]) {
      const source = readFileSync(page, 'utf8');
      expect(source).toContain('href={WEBSITE_URL}');
      expect(source).toMatch(/\/> Website\s*\n/);
    }
  });
});
