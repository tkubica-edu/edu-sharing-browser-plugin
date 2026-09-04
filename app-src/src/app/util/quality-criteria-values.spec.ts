import { describe, expect, it } from 'vitest';
import type { MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import {
  CRITERIA_PROPERTIES,
  CRITERION_MET,
  CRITERION_VIOLATED,
  EDITORIAL_CRITERIA_PROPERTY,
  KNOCKOUT_CRITERIA_WIDGET,
  autoMetValue,
  valueFor,
  widgetOf,
  withoutQualityCriteria,
} from './quality-criteria-values';

const QUALITY = 'http://w3id.org/openeduhub/vocabs/quality';

function aWidget(id: string, values: MdsValue[]): MdsWidget {
  return { id, values } as unknown as MdsWidget;
}

/** A criterion under the quality vocabulary: its answers carry the vocabulary's ids beside their own. */
const MAPPED = aWidget('ccm:oeh_quality_copyright_law', [
  { id: 'einwandfrei', caption: 'Keine Beanstandung', alternativeIds: [`${QUALITY}/3`, '3'] },
  { id: 'verstoss', caption: 'Verstoß', alternativeIds: ['0'] },
  { id: 'maschinell', caption: 'Keine Auffälligkeiten (Maschine)', alternativeIds: [`${QUALITY}/2`] },
] as MdsValue[]);

/** A criterion whose valuespace maps nothing, where the value ids are the answer themselves. */
const PLAIN = aWidget('ccm:oeh_quality_neutralness', [
  { id: '1', caption: 'Erfüllt' },
  { id: '0', caption: 'Nicht erfüllt' },
] as MdsValue[]);

describe('CRITERIA_PROPERTIES', () => {
  it('names the editorial criteria\'s shared property alongside the knock-out ones', () => {
    expect(CRITERIA_PROPERTIES).toContain(EDITORIAL_CRITERIA_PROPERTY);
    expect(EDITORIAL_CRITERIA_PROPERTY).toBe('ccm:oeh_buffet_criteria');
    expect(KNOCKOUT_CRITERIA_WIDGET).toBe('virtual:unmetLegalCriteria');
  });

  it('gives every knock-out criterion a property of its own', () => {
    expect(CRITERIA_PROPERTIES.filter((property) => property !== EDITORIAL_CRITERIA_PROPERTY)).toEqual([
      'ccm:oeh_quality_relevancy_for_education',
      'ccm:oeh_quality_criminal_law',
      'ccm:oeh_quality_protection_of_minors',
      'ccm:oeh_quality_data_privacy',
      'ccm:oeh_quality_copyright_law',
      'ccm:oeh_quality_personal_law',
      'ccm:oeh_quality_neutralness',
    ]);
  });
});

describe('withoutQualityCriteria', () => {
  it('drops every criterion the model answered itself, in which nothing was established', () => {
    expect(
      withoutQualityCriteria({
        'cclom:title': 'Optik',
        'ccm:oeh_quality_copyright_law': ['einwandfrei'],
        'ccm:oeh_quality_data_privacy': ['einwandfrei'],
        [EDITORIAL_CRITERIA_PROPERTY]: ['sachrichtigkeit'],
      }),
    ).toEqual({ 'cclom:title': 'Optik' });
  });

  it('leaves the ratings beside them alone — those are ratings, not answers to a criterion', () => {
    expect(
      withoutQualityCriteria({
        'ccm:oeh_quality_correctness': ['3'],
        'ccm:oeh_quality_didactics': ['2'],
      }),
    ).toEqual({ 'ccm:oeh_quality_correctness': ['3'], 'ccm:oeh_quality_didactics': ['2'] });
  });

  it('leaves a payload that answered no criterion unchanged', () => {
    expect(withoutQualityCriteria({ 'cclom:title': 'Optik' })).toEqual({ 'cclom:title': 'Optik' });
    expect(withoutQualityCriteria({})).toEqual({});
  });

  it('never writes into the payload it was handed', () => {
    const payload = { 'ccm:oeh_quality_data_privacy': ['einwandfrei'] };
    withoutQualityCriteria(payload);
    expect(payload).toEqual({ 'ccm:oeh_quality_data_privacy': ['einwandfrei'] });
  });
});

describe('widgetOf', () => {
  it('finds the widget the metadata set defines under this id', () => {
    expect(widgetOf([MAPPED, PLAIN], 'ccm:oeh_quality_neutralness')).toBe(PLAIN);
  });

  it('finds nothing for a criterion the set does not define, or a set that is not loaded', () => {
    expect(widgetOf([MAPPED], 'ccm:oeh_quality_data_privacy')).toBeUndefined();
    expect(widgetOf(undefined, 'ccm:oeh_quality_data_privacy')).toBeUndefined();
  });
});

describe('autoMetValue', () => {
  it('finds the value a machine\'s all-clear is recorded in, by the term at the end of its URI', () => {
    const widget = aWidget('ccm:oeh_quality_data_privacy', [
      { id: `${QUALITY}/no_auto_findings`, caption: 'Keine automatischen Funde' },
      { id: `${QUALITY}/3`, caption: 'Keine Beanstandung' },
    ] as MdsValue[]);
    expect(autoMetValue(widget)).toBe(`${QUALITY}/no_auto_findings`);
  });

  it('reads a bare value id as its own term', () => {
    const widget = aWidget('ccm:oeh_quality_data_privacy', [
      { id: 'no_auto_findings', caption: 'Keine automatischen Funde' },
    ] as MdsValue[]);
    expect(autoMetValue(widget)).toBe('no_auto_findings');
  });

  it('finds nothing on a criterion whose valuespace states no such term', () => {
    expect(autoMetValue(MAPPED)).toBeUndefined();
    expect(autoMetValue(PLAIN)).toBeUndefined();
    expect(autoMetValue(undefined)).toBeUndefined();
  });
});

describe('valueFor', () => {
  it('takes the value mapped to the vocabulary\'s entry, however the set spells its own id', () => {
    expect(valueFor(MAPPED, CRITERION_MET)).toBe('einwandfrei');
    expect(valueFor(MAPPED, CRITERION_VIOLATED)).toBe('verstoss');
  });

  it('takes the plain yes/no id where the valuespace maps nothing', () => {
    expect(valueFor(PLAIN, CRITERION_MET)).toBe('1');
    expect(valueFor(PLAIN, CRITERION_VIOLATED)).toBe('0');
  });

  it('gives no answer where a mapped vocabulary lacks the entry, rather than guessing at a rating', () => {
    const rating = aWidget('ccm:oeh_quality_correctness', [
      { id: 'sehr_gut', alternativeIds: ['1'] },
      { id: 'gut', alternativeIds: ['2'] },
    ] as MdsValue[]);
    expect(valueFor(rating, CRITERION_MET)).toBeUndefined();
    expect(valueFor(rating, CRITERION_VIOLATED)).toBeUndefined();
  });

  it('gives no answer for a widget that offers no values at all', () => {
    expect(valueFor(aWidget('ccm:oeh_quality_data_privacy', []), CRITERION_MET)).toBeUndefined();
    expect(valueFor(undefined, CRITERION_MET)).toBeUndefined();
  });

  it('gives no answer where an unmapped valuespace lacks the plain id', () => {
    const widget = aWidget('ccm:oeh_quality_data_privacy', [
      { id: 'ja' },
      { id: 'nein' },
    ] as MdsValue[]);
    expect(valueFor(widget, CRITERION_MET)).toBeUndefined();
  });

  it('states the two answers as the quality vocabulary writes them', () => {
    expect(CRITERION_MET).toBe('3');
    expect(CRITERION_VIOLATED).toBe('0');
  });
});
