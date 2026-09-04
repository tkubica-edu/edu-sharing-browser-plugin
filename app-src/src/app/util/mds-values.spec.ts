import { describe, expect, it } from 'vitest';

import { firstString, stringValues, toMdsEditorValues, toMdsValues } from './mds-values';

describe('firstString', () => {
  it('takes the value a property states as a scalar', () => {
    expect(firstString('Optik')).toBe('Optik');
  });

  it('takes the first of the values a property states as a list', () => {
    expect(firstString(['Optik', 'Akustik'])).toBe('Optik');
    expect(firstString([['Optik']])).toBe('Optik');
  });

  it('answers nothing for a property that states nothing usable, so a caller can chain fallbacks', () => {
    expect(firstString(null)).toBeNull();
    expect(firstString(undefined)).toBeNull();
    expect(firstString('')).toBeNull();
    expect(firstString('   ')).toBeNull();
    expect(firstString([])).toBeNull();
    expect(firstString([''])).toBeNull();
    expect(firstString(7)).toBeNull();
    expect(firstString(['', 'Optik'])).toBeNull();
  });

  it('keeps the value as it is spelled, blanks around it included', () => {
    expect(firstString(' Optik ')).toBe(' Optik ');
  });
});

describe('stringValues', () => {
  it('reads a property stated as a list', () => {
    expect(stringValues(['Optik', 'Akustik'])).toEqual(['Optik', 'Akustik']);
  });

  it('reads a property stated as one joined string, which is how a multi-value schema describes it', () => {
    expect(stringValues('Optik, Akustik')).toEqual(['Optik', 'Akustik']);
    expect(stringValues(['Optik, Akustik', 'Mechanik'])).toEqual(['Optik', 'Akustik', 'Mechanik']);
  });

  it('trims every value and drops the blank ones', () => {
    expect(stringValues([' Optik ', '', '  ', 'Akustik'])).toEqual(['Optik', 'Akustik']);
    expect(stringValues('Optik,,Akustik,')).toEqual(['Optik', 'Akustik']);
  });

  it('reads an empty property as no values at all', () => {
    expect(stringValues(null)).toEqual([]);
    expect(stringValues(undefined)).toEqual([]);
    expect(stringValues('')).toEqual([]);
    expect(stringValues([])).toEqual([]);
  });

  it('reads a value that is no string as the string it spells', () => {
    expect(stringValues(2024)).toEqual(['2024']);
    expect(stringValues([true, 3])).toEqual(['true', '3']);
  });
});

describe('toMdsValues', () => {
  it('states every property as the list of strings MDS and the repository expect', () => {
    expect(toMdsValues({ 'cclom:title': 'Optik', 'ccm:taxonid': ['380', '460'] })).toEqual({
      'cclom:title': ['Optik'],
      'ccm:taxonid': ['380', '460'],
    });
  });

  it('drops a property that states nothing rather than emptying it', () => {
    expect(toMdsValues({ 'cclom:title': 'Optik', 'ccm:taxonid': null, 'ccm:author': undefined })).toEqual({
      'cclom:title': ['Optik'],
    });
  });

  it('keeps a property that states an empty value, which is not the same as stating none', () => {
    expect(toMdsValues({ 'cclom:title': '', 'ccm:taxonid': [] })).toEqual({
      'cclom:title': [''],
      'ccm:taxonid': [],
    });
  });

  it('spells a value that is no string', () => {
    expect(toMdsValues({ 'ccm:duration': 45, 'ccm:free': false })).toEqual({
      'ccm:duration': ['45'],
      'ccm:free': ['false'],
    });
  });

  it('reads no values at all as no properties', () => {
    expect(toMdsValues(null)).toEqual({});
    expect(toMdsValues(undefined)).toEqual({});
  });
});

describe('toMdsEditorValues', () => {
  it('keeps the namespaced property keys and drops the payload\'s envelope', () => {
    expect(
      toMdsEditorValues({
        'cclom:title': 'Optik',
        'ccm:taxonid': ['380'],
        contextName: 'wlo',
        schemaVersion: '1.0',
        _source_text: 'Der Artikel selbst.',
      }),
    ).toEqual({ 'cclom:title': ['Optik'], 'ccm:taxonid': ['380'] });
  });

  it('normalizes what it keeps, so a scalar field is not indexed like an array by the editor', () => {
    expect(toMdsEditorValues({ 'cclom:title': 'Optik' })['cclom:title']).toEqual(['Optik']);
  });

  it('reads no payload as no values', () => {
    expect(toMdsEditorValues(null)).toEqual({});
    expect(toMdsEditorValues({})).toEqual({});
  });
});
