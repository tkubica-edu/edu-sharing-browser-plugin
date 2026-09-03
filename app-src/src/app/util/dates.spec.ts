import { describe, expect, it } from 'vitest';

import { toDurationMs, toIsoDate } from './dates';

describe('toIsoDate', () => {
  it('reads the spellings a page dates itself in', () => {
    expect(toIsoDate('2024-05-06')).toBe('2024-05-06');
    expect(toIsoDate('2024-05-06T11:22:33Z')).toBe('2024-05-06');
    expect(toIsoDate('06.05.2024')).toBe('2024-05-06');
    expect(toIsoDate('6.5.2024')).toBe('2024-05-06');
    expect(toIsoDate('2024/05/06')).toBe('2024-05-06');
  });

  it('reads a bare year as its first day, which is the only date it names', () => {
    expect(toIsoDate('2024')).toBe('2024-01-01');
  });

  it('refuses a date whose order cannot be told', () => {
    expect(toIsoDate('05/06/2024')).toBeNull();
  });

  it('refuses a day that does not exist', () => {
    expect(toIsoDate('2024-02-31')).toBeNull();
    expect(toIsoDate('31.02.2024')).toBeNull();
  });

  it('refuses everything that is not a date', () => {
    expect(toIsoDate('bald')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(20240506)).toBeNull();
  });
});

describe('toDurationMs', () => {
  it('reads an ISO-8601 duration', () => {
    expect(toDurationMs('PT45M')).toBe(45 * 60 * 1000);
    expect(toDurationMs('PT1H30M')).toBe(90 * 60 * 1000);
    expect(toDurationMs('P1DT2H')).toBe(26 * 60 * 60 * 1000);
    expect(toDurationMs('PT90S')).toBe(90 * 1000);
    expect(toDurationMs('P2W')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('refuses a duration in months or years — those are no fixed amount of time', () => {
    expect(toDurationMs('P1M')).toBeNull();
    expect(toDurationMs('P1Y')).toBeNull();
  });

  it('refuses everything that is not a duration, and a duration of nothing', () => {
    expect(toDurationMs('45 Minuten')).toBeNull();
    expect(toDurationMs('P')).toBeNull();
    expect(toDurationMs('PT0M')).toBeNull();
    expect(toDurationMs(null)).toBeNull();
  });
});
