import { describe, expect, it } from 'vitest';

import { normalizeVersion, selectBundleVersion } from './edu-bundle-versions';

describe('normalizeVersion', () => {
  it('ignores a patch component', () => {
    expect(normalizeVersion('11.0.2')).toBe('11.0');
  });

  it('leaves a bare major.minor as is', () => {
    expect(normalizeVersion('11.0')).toBe('11.0');
  });

  it('fills in a missing minor as .0', () => {
    expect(normalizeVersion('11')).toBe('11.0');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeVersion('  11.2.3  ')).toBe('11.2');
  });

  it('reports no version for a string naming none', () => {
    expect(normalizeVersion('unknown')).toBeNull();
    expect(normalizeVersion('')).toBeNull();
  });
});

describe('selectBundleVersion', () => {
  it('picks the exact major.minor match', () => {
    expect(selectBundleVersion('11.0', ['11.0', '12.0'])).toEqual({ version: '11.0', exact: true });
  });

  it('falls back to the closest packaged minor below a newer one of the same major', () => {
    expect(selectBundleVersion('11.3', ['11.0', '12.0'])).toEqual({ version: '11.0', exact: false });
  });

  it('falls back to the lowest packaged minor of the same major where none is below it', () => {
    expect(selectBundleVersion('11.0', ['11.2', '11.5'])).toEqual({ version: '11.2', exact: false });
  });

  it('refuses where no packaged bundle shares the reported major', () => {
    expect(selectBundleVersion('10.3', ['11.0', '12.0'])).toEqual({ version: null, exact: false });
  });

  it('uses the newest packaged bundle where the repository named no version', () => {
    expect(selectBundleVersion(null, ['11.0', '12.0'])).toEqual({ version: '12.0', exact: false });
  });

  it('refuses where no bundle is packaged at all', () => {
    expect(selectBundleVersion('11.0', [])).toEqual({ version: null, exact: false });
  });
});
