import { describe, expect, it } from 'vitest';

import { LICENSE_ASPECTS, LICENSE_FIELDS, LICENSE_KEY, mapAgentFields, withAgentLicense } from './agent-fields';

describe('LICENSE_FIELDS', () => {
  it('names the licence, its version and the flags that belong with it', () => {
    expect(LICENSE_FIELDS).toEqual([
      'ccm:commonlicense_key',
      'ccm:commonlicense_cc_version',
      'ccm:commonlicense_ai_allow_usage',
      'ccm:commonlicense_ai_generated',
      'ccm:commonlicense_ai_manually_modified',
    ]);
  });

  it('names the aspects a node carries a licence under', () => {
    expect(LICENSE_ASPECTS).toEqual(['ccm:licenses', 'ccm:commonlicenses']);
  });
});

describe('mapAgentFields', () => {
  it('copies the combined publisher to the author free text the form actually has', () => {
    expect(mapAgentFields({ 'ccm:oeh_publisher_combined': 'Landesbildungsserver' })).toEqual({
      'ccm:oeh_publisher_combined': 'Landesbildungsserver',
      'ccm:author_freetext': ['Landesbildungsserver'],
    });
  });

  it('leaves an author free text the payload already states', () => {
    expect(
      mapAgentFields({
        'ccm:oeh_publisher_combined': 'Landesbildungsserver',
        'ccm:author_freetext': ['Ada Lovelace'],
      })['ccm:author_freetext'],
    ).toEqual(['Ada Lovelace']);
  });

  it('turns the licence label into the key the form knows it by', () => {
    expect(mapAgentFields({ [LICENSE_KEY]: 'CC BY-SA 4.0' })[LICENSE_KEY]).toEqual(['CC_BY_SA_4_0']);
    expect(mapAgentFields({ [LICENSE_KEY]: '  cc-by  ' })[LICENSE_KEY]).toEqual(['CC_BY']);
    expect(mapAgentFields({ [LICENSE_KEY]: ['cc0'] })[LICENSE_KEY]).toEqual(['CC0']);
  });

  it('states the flags that mean nothing without the licence, alongside it', () => {
    expect(mapAgentFields({ [LICENSE_KEY]: 'CC_BY' })).toEqual({
      [LICENSE_KEY]: ['CC_BY'],
      'ccm:commonlicense_ai_allow_usage': ['true'],
      'ccm:commonlicense_ai_generated': ['false'],
      'ccm:commonlicense_ai_manually_modified': ['false'],
    });
  });

  it('leaves a flag the payload states itself', () => {
    expect(
      mapAgentFields({ [LICENSE_KEY]: 'CC_BY', 'ccm:commonlicense_ai_generated': ['true'] })[
        'ccm:commonlicense_ai_generated'
      ],
    ).toEqual(['true']);
  });

  it('states no licence flags for a payload that names no licence', () => {
    expect(mapAgentFields({ 'cclom:title': 'Optik' })).toEqual({ 'cclom:title': 'Optik' });
  });

  it('changes nothing on a second run — the mapping is its own fixed point', () => {
    const once = mapAgentFields({
      [LICENSE_KEY]: 'CC BY-SA 4.0',
      'ccm:oeh_publisher_combined': 'Landesbildungsserver',
    });
    expect(mapAgentFields(once)).toEqual(once);
  });

  it('never writes into the payload it was handed', () => {
    const payload = { [LICENSE_KEY]: 'CC BY' };
    mapAgentFields(payload);
    expect(payload).toEqual({ [LICENSE_KEY]: 'CC BY' });
  });

  it('reads no payload as no fields', () => {
    expect(mapAgentFields(null)).toEqual({});
    expect(mapAgentFields(undefined)).toEqual({});
  });
});

describe('withAgentLicense', () => {
  it('takes the licence from the payload where the form carries no widget for it', () => {
    expect(withAgentLicense({ 'cclom:title': ['Optik'] }, { [LICENSE_KEY]: 'CC BY-SA' })).toEqual({
      'cclom:title': ['Optik'],
      [LICENSE_KEY]: ['CC_BY_SA'],
      'ccm:commonlicense_ai_allow_usage': ['true'],
      'ccm:commonlicense_ai_generated': ['false'],
      'ccm:commonlicense_ai_manually_modified': ['false'],
    });
  });

  it('normalizes a licence the form did report rather than replacing it with the payload\'s', () => {
    expect(
      withAgentLicense({ [LICENSE_KEY]: ['cc by'] }, { [LICENSE_KEY]: 'CC0' })[LICENSE_KEY],
    ).toEqual(['CC_BY']);
  });

  it('keeps the version the payload states, which nothing here decides', () => {
    expect(
      withAgentLicense({}, { [LICENSE_KEY]: 'CC BY', 'ccm:commonlicense_cc_version': '4.0' })[
        'ccm:commonlicense_cc_version'
      ],
    ).toEqual(['4.0']);
  });

  it('states no licence where neither the form nor the payload names one', () => {
    expect(withAgentLicense({ 'cclom:title': ['Optik'] }, { 'cclom:title': 'Optik' })).toEqual({
      'cclom:title': ['Optik'],
    });
    expect(withAgentLicense({ 'cclom:title': ['Optik'] }, null)).toEqual({ 'cclom:title': ['Optik'] });
  });

  it('leaves every field that is not the licence as the form reported it', () => {
    expect(
      withAgentLicense(
        { 'ccm:taxonid': ['380', '460'] },
        { 'ccm:taxonid': ['120'], 'ccm:oeh_publisher_combined': 'Landesbildungsserver' },
      ),
    ).toEqual({ 'ccm:taxonid': ['380', '460'] });
  });

  it('never writes into the values it was handed', () => {
    const values = { 'cclom:title': ['Optik'] };
    withAgentLicense(values, { [LICENSE_KEY]: 'CC BY' });
    expect(values).toEqual({ 'cclom:title': ['Optik'] });
  });
});
