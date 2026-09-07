import { describe, it, expect } from 'vitest';
import { parseDisplayToBaseUnits, formatBaseUnitsToDisplay, compareBaseUnits, addBaseUnits, subtractBaseUnits } from './money';

describe('Money / Base Unit Utilities', () => {
  it('converts display decimal strings to base units', () => {
    expect(parseDisplayToBaseUnits('5', 6)).toBe('5000000');
    expect(parseDisplayToBaseUnits('5.25', 6)).toBe('5250000');
    expect(parseDisplayToBaseUnits('0.000001', 6)).toBe('1');
    expect(parseDisplayToBaseUnits('100.500000', 6)).toBe('100500000');
  });

  it('rejects invalid decimal strings or excess precision', () => {
    expect(() => parseDisplayToBaseUnits('invalid')).toThrow();
    expect(() => parseDisplayToBaseUnits('5.1234567', 6)).toThrow('exceeds maximum supported precision');
  });

  it('formats base units to display strings', () => {
    expect(formatBaseUnitsToDisplay('5000000', 6)).toBe('5.000000');
    expect(formatBaseUnitsToDisplay('5250000', 6)).toBe('5.250000');
    expect(formatBaseUnitsToDisplay('1', 6)).toBe('0.000001');
    expect(formatBaseUnitsToDisplay('0', 6)).toBe('0.000000');
  });

  it('performs exact comparisons and arithmetic', () => {
    expect(compareBaseUnits('5000000', '5000000')).toBe(0);
    expect(compareBaseUnits('5000001', '5000000')).toBe(1);
    expect(compareBaseUnits('4999999', '5000000')).toBe(-1);

    expect(addBaseUnits('1500000', '3500000')).toBe('5000000');
    expect(subtractBaseUnits('5000000', '1500000')).toBe('3500000');
    expect(() => subtractBaseUnits('100', '500')).toThrow();
  });
});
