import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalBytes, canonicalize } from './jcs';

describe('canonicalize (RFC 8785)', () => {
  it('reproduces the RFC 8785 §3.2.3 example (number formatting, escapes, key order)', () => {
    const chr = String.fromCharCode;
    // Built from code points so the vector cannot be mangled by editors or tooling.
    const string = [chr(0x20ac), '$', chr(0x0f), chr(0x0a), 'A', chr(0x27), 'B', chr(0x22), chr(0x5c), chr(0x5c), chr(0x22), '/'].join('');
    const input = {
      numbers: JSON.parse('[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001]'),
      string,
      literals: [null, true, false],
    };
    const bs = chr(0x5c);
    const expectedString =
      chr(0x22) + chr(0x20ac) + '$' + bs + 'u000f' + bs + 'nA' + chr(0x27) + 'B' + bs + chr(0x22) + bs + bs + bs + bs + bs + chr(0x22) + '/' + chr(0x22);
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":' + expectedString + '}',
    );
  });

  it('sorts members by UTF-16 code units (RFC 8785 §3.2.3 sorting example)', () => {
    const chr = String.fromCharCode;
    const expectedOrder = [chr(0x0d), '1', chr(0x80), chr(0xf6), chr(0x20ac), chr(0xd83d, 0xde00), chr(0xfb33)];
    const input: Record<string, string> = {};
    for (const key of [...expectedOrder].reverse()) input[key] = 'v';
    const output = canonicalize(input);
    const positions = expectedOrder.map((key) => output.indexOf(JSON.stringify(key) + ':'));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('serialises -0 as 0 and rejects NaN/Infinity', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError);
  });

  it('rejects values JSON cannot represent instead of silently dropping them', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(/Undefined member/);
    expect(() => canonicalize({ a: 1n })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Date(0))).toThrow(/plain objects/);
    expect(() => canonicalize(new Map())).toThrow(/plain objects/);
  });

  it('rejects lone surrogates (RFC 8785 requires well-formed Unicode)', () => {
    expect(() => canonicalize('\ud800')).toThrow(/surrogate/);
    expect(() => canonicalize({ '\udc00': 1 })).toThrow(/surrogate/);
    expect(canonicalize('😀')).toBe('"😀"');
  });

  it('enforces a maximum nesting depth', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(() => canonicalize(deep)).toThrow(/depth/);
  });

  it('emits UTF-8 bytes of the canonical string', () => {
    expect(new TextDecoder().decode(canonicalBytes({ b: '€', a: 1 }))).toBe('{"a":1,"b":"€"}');
  });

  describe('properties', () => {
    it('is idempotent: canonicalising a parse of the canonical form changes nothing', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const once = canonicalize(value);
          expect(canonicalize(JSON.parse(once))).toBe(once);
        }),
        { numRuns: 300 },
      );
    });

    it('is independent of object member insertion order', () => {
      fc.assert(
        fc.property(fc.dictionary(fc.string(), fc.integer()), (dict) => {
          const forward = Object.fromEntries(Object.entries(dict));
          const backward = Object.fromEntries(Object.entries(dict).reverse());
          expect(canonicalize(forward)).toBe(canonicalize(backward));
        }),
        { numRuns: 300 },
      );
    });

    it('never contains insignificant whitespace outside strings', () => {
      fc.assert(
        fc.property(fc.dictionary(fc.constantFrom('a', 'b', 'c'), fc.array(fc.integer(), { maxLength: 4 })), (dict) => {
          expect(canonicalize(dict)).not.toMatch(/\s/);
        }),
        { numRuns: 100 },
      );
    });
  });
});
