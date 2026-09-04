import { describe, expect, it } from 'vitest';

import {
  ENVELOPE_KEYS,
  EXTENDED_DATA_FIELD,
  EXTENDED_TEXT_FIELD,
  EXTENDED_TYPE_FIELD,
  LRT_AGGREGATED_FIELD,
  LRT_FIELD,
  SOURCE_TEXT_KEY,
  sourceTextOf,
  toEnvelope,
  toExportPayload,
  toExtendedFields,
  toPayloadFields,
} from './agent-payload';

const OFFER = 'http://w3id.org/openeduhub/vocabs/contentTypes/education_offer';
const WORKSHEET = 'http://w3id.org/openeduhub/vocabs/new_lrt/03ab835b-0000-0000-0000-000000000000';
const VIDEO = 'http://w3id.org/openeduhub/vocabs/new_lrt/7a6e9979-0000-0000-0000-000000000000';

/** A payload as the metadata agent hands it over: an envelope, its fields, and the text it read them from. */
function aPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contextName: 'wlo',
    schemaVersion: '1.0',
    metadataset: 'mds_oeh',
    exportedAt: '2026-05-06T11:22:33Z',
    'cclom:title': 'Optik',
    [SOURCE_TEXT_KEY]: 'Der Artikel selbst.',
    ...overrides,
  };
}

describe('toPayloadFields', () => {
  it('states every property as the list it is, however many values it holds', () => {
    expect(toPayloadFields({ 'cclom:title': ['Optik'], 'ccm:taxonid': ['380', '460'] })).toEqual({
      'cclom:title': ['Optik'],
      'ccm:taxonid': ['380', '460'],
    });
  });

  it('leaves out an empty property, which would clear a field the editor never touched', () => {
    expect(toPayloadFields({ 'cclom:title': ['Optik'], 'ccm:taxonid': [] })).toEqual({
      'cclom:title': ['Optik'],
    });
  });
});

describe('toEnvelope', () => {
  it('takes the keys the payload carries beside its fields, and nothing else', () => {
    expect(toEnvelope(aPayload())).toEqual({
      contextName: 'wlo',
      schemaVersion: '1.0',
      metadataset: 'mds_oeh',
      exportedAt: '2026-05-06T11:22:33Z',
    });
  });

  it('leaves out an envelope key the agent did not deliver', () => {
    expect(Object.keys(toEnvelope({ contextName: 'wlo', language: null, _origins: undefined }))).toEqual([
      'contextName',
    ]);
  });

  it('leaves the raw text out, because it travels separately', () => {
    expect(ENVELOPE_KEYS).not.toContain(SOURCE_TEXT_KEY);
    expect(toEnvelope(aPayload())).not.toHaveProperty(SOURCE_TEXT_KEY);
  });

  it('reads no payload as an empty envelope', () => {
    expect(toEnvelope(null)).toEqual({});
  });
});

describe('toExportPayload', () => {
  it('states the envelope at the top and the properties one level in, as the canvas does', () => {
    expect(toExportPayload({ 'cclom:title': ['Optik'] }, { contextName: 'wlo', language: 'de' })).toEqual({
      contextName: 'wlo',
      language: 'de',
      metadata: { 'cclom:title': ['Optik'] },
    });
  });

  it('states an empty metadata block for a content nothing was filled in for', () => {
    expect(toExportPayload({}, null)).toEqual({ metadata: {} });
  });
});

describe('toExtendedFields', () => {
  it('states the content type as the single value its widget takes', () => {
    const fields = toExtendedFields({ [EXTENDED_TYPE_FIELD]: [OFFER] }, null);
    expect(fields[EXTENDED_TYPE_FIELD]).toEqual([OFFER]);
  });

  it('takes the content type from the payload where the form reported none', () => {
    expect(toExtendedFields({}, aPayload({ [EXTENDED_TYPE_FIELD]: OFFER }))[EXTENDED_TYPE_FIELD]).toEqual([
      OFFER,
    ]);
  });

  it('takes only one content type from a payload that states several', () => {
    expect(
      toExtendedFields({}, aPayload({ [EXTENDED_TYPE_FIELD]: [OFFER, 'zweiter'] }))[EXTENDED_TYPE_FIELD],
    ).toEqual([OFFER]);
  });

  it('states every material type there is, because a content is several at once', () => {
    const fields = toExtendedFields({ [LRT_FIELD]: [WORKSHEET, VIDEO] }, null);
    expect(fields[LRT_FIELD]).toEqual([WORKSHEET, VIDEO]);
  });

  it('takes the material types from the payload where the form reported none', () => {
    const fields = toExtendedFields({}, aPayload({ [LRT_FIELD]: [WORKSHEET], [LRT_AGGREGATED_FIELD]: VIDEO }));
    expect(fields[LRT_FIELD]).toEqual([WORKSHEET]);
    expect(fields[LRT_AGGREGATED_FIELD]).toEqual([VIDEO]);
  });

  it('prefers what the form reported over what the payload stated', () => {
    expect(toExtendedFields({ [LRT_FIELD]: [VIDEO] }, aPayload({ [LRT_FIELD]: [WORKSHEET] }))[LRT_FIELD]).toEqual([
      VIDEO,
    ]);
  });

  it('states the raw text the metadata was read from', () => {
    expect(toExtendedFields({}, aPayload())[EXTENDED_TEXT_FIELD]).toEqual(['Der Artikel selbst.']);
  });

  it('states the whole payload as JSON for every content, even one described by nothing else', () => {
    const fields = toExtendedFields({}, null);
    expect(Object.keys(fields)).toEqual([EXTENDED_DATA_FIELD]);
    expect(JSON.parse(fields[EXTENDED_DATA_FIELD][0])).toEqual({ metadata: {} });
  });

  it('states the JSON as the export shape, so the node holds what the agent\'s upload reads', () => {
    const fields = toExtendedFields({ 'cclom:title': ['Optik'] }, aPayload());
    expect(JSON.parse(fields[EXTENDED_DATA_FIELD][0])).toEqual({
      contextName: 'wlo',
      schemaVersion: '1.0',
      metadataset: 'mds_oeh',
      exportedAt: '2026-05-06T11:22:33Z',
      metadata: { 'cclom:title': ['Optik'] },
    });
  });

  it('leaves out a field neither side states rather than emptying it', () => {
    const fields = toExtendedFields({}, { contextName: 'wlo' });
    expect(fields).not.toHaveProperty(EXTENDED_TYPE_FIELD);
    expect(fields).not.toHaveProperty(LRT_FIELD);
    expect(fields).not.toHaveProperty(EXTENDED_TEXT_FIELD);
  });
});

describe('sourceTextOf', () => {
  it('reads the agent\'s own field', () => {
    expect(sourceTextOf({ [SOURCE_TEXT_KEY]: 'Der Artikel selbst.' })).toBe('Der Artikel selbst.');
  });

  it('falls back to the field a node written from such a payload keeps it in', () => {
    expect(sourceTextOf({ [EXTENDED_TEXT_FIELD]: ['Der Artikel selbst.'] })).toBe('Der Artikel selbst.');
  });

  it('prefers the agent\'s field over the node\'s', () => {
    expect(
      sourceTextOf({ [SOURCE_TEXT_KEY]: 'frisch gelesen', [EXTENDED_TEXT_FIELD]: ['vom Knoten'] }),
    ).toBe('frisch gelesen');
  });

  it('answers nothing for a content whose wording nothing states', () => {
    expect(sourceTextOf(null)).toBeNull();
    expect(sourceTextOf(undefined)).toBeNull();
    expect(sourceTextOf({ [SOURCE_TEXT_KEY]: '   ' })).toBeNull();
    expect(sourceTextOf({ [EXTENDED_TEXT_FIELD]: [] })).toBeNull();
  });
});
