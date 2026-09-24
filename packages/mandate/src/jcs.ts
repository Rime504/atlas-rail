/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Hashes and signatures over JSON are only meaningful if every party serialises the same value to
 * the same bytes. JCS gives us that: object members sorted by UTF-16 code units, no insignificant
 * whitespace, ECMAScript number formatting, minimal string escaping.
 *
 * This implementation is intentionally strict. It rejects anything JSON cannot represent
 * (`undefined`, functions, symbols, bigint, NaN/Infinity), anything that is not a plain object or
 * array, and strings containing lone surrogates (RFC 8785 §3.2.2.2 requires well-formed Unicode).
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 64;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function assertWellFormedString(value: string, path: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalizationError(`Lone high surrogate in string at ${path}`);
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError(`Lone low surrogate in string at ${path}`);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialise(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH) throw new CanonicalizationError(`Maximum depth exceeded at ${path}`);

  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      assertWellFormedString(value, path);
      // JSON.stringify escaping is exactly the JCS escaping (lowercase \u00xx, short escapes for \b\t\n\f\r).
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`Non-finite number at ${path}`);
      }
      // ECMAScript Number::toString is normative for JCS; JSON.stringify(-0) === "0" as required.
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonicalizationError(`Unsupported value of type ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => serialise(item, `${path}[${i}]`, depth + 1)).join(',')}]`;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalizationError(`Only plain objects and arrays can be canonicalised (at ${path})`);
  }

  const keys = Object.keys(value).sort(); // default sort = UTF-16 code unit order, as JCS requires
  const members = keys.map((key) => {
    assertWellFormedString(key, `${path}.<key>`);
    const member = value[key];
    if (member === undefined) {
      throw new CanonicalizationError(`Undefined member "${key}" at ${path}; remove it or use null`);
    }
    return `${JSON.stringify(key)}:${serialise(member, `${path}.${key}`, depth + 1)}`;
  });
  return `{${members.join(',')}}`;
}

/** Returns the JCS serialisation of `value` as a string. */
export function canonicalize(value: unknown): string {
  return serialise(value, '$', 0);
}

/** Returns the JCS serialisation of `value` as UTF-8 bytes. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
