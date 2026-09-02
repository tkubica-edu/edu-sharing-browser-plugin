import { MdsDefinition } from 'ngx-edu-sharing-api';
import { describe, expect, it } from 'vitest';

import { aiConfigWidgets, formWidgets } from './mds-form-widgets';

/**
 * A set with two groups: the `io` form of the two views below, and a `search` form of a view the `io` one
 * does not name. `ccm:taxonid` is defined twice, once for the template of the second view.
 */
function aSet(overrides: Partial<MdsDefinition> = {}): MdsDefinition {
  return {
    id: 'mds_oeh',
    name: 'mds_oeh',
    groups: [
      { id: 'io', views: ['io_general', 'io_classification'] },
      { id: 'search', views: ['search_general'] },
    ],
    views: [
      {
        id: 'io_general',
        html: '<div class="row"><cclom:title></cclom:title><ccm:general_description /></div>',
      },
      { id: 'io_classification', html: '<ccm:taxonid></ccm:taxonid><license></license>' },
      { id: 'search_general', html: '<ccm:replicationsource></ccm:replicationsource>' },
    ],
    widgets: [
      { id: 'cclom:title', aiConfigs: [{ id: 'default' }] },
      { id: 'ccm:general_description', aiConfigs: [{ id: 'other' }, { id: 'default' }] },
      { id: 'ccm:taxonid' },
      { id: 'ccm:taxonid', template: ['io_classification'], aiConfigs: [{ id: 'taxon' }] },
      { id: 'license' },
      { id: 'ccm:replicationsource', aiConfigs: [{ id: 'default' }] },
    ],
    lists: [],
    sorts: [],
    ...overrides,
  };
}

describe('formWidgets', () => {
  it('takes the widgets the group\'s views place, in the order they are placed', () => {
    expect(formWidgets(aSet(), 'io').map((widget) => widget.id)).toEqual([
      'cclom:title',
      'ccm:general_description',
      'ccm:taxonid',
      'license',
    ]);
  });

  it('takes the definition of the view being rendered where a widget is defined per template', () => {
    const taxon = formWidgets(aSet(), 'io').find((widget) => widget.id === 'ccm:taxonid');
    expect(taxon?.template).toEqual(['io_classification']);
  });

  it('takes nothing for a group the set does not know', () => {
    expect(formWidgets(aSet(), 'collection')).toEqual([]);
  });
});

describe('aiConfigWidgets', () => {
  it('asks for the form\'s generatable fields, under the config named default', () => {
    expect(aiConfigWidgets(aSet(), 'io')).toEqual([
      { widgetId: 'cclom:title', aiConfigId: 'default' },
      { widgetId: 'ccm:general_description', aiConfigId: 'default' },
      { widgetId: 'ccm:taxonid', aiConfigId: 'taxon' },
    ]);
  });

  it('leaves out the fields the run works from', () => {
    expect(
      aiConfigWidgets(aSet(), 'io', ['cclom:title', 'textContent']).map((widget) => widget.widgetId),
    ).toEqual(['ccm:general_description', 'ccm:taxonid']);
  });

  it('leaves out a generatable field of the set that this form does not show', () => {
    expect(aiConfigWidgets(aSet(), 'io').map((widget) => widget.widgetId)).not.toContain(
      'ccm:replicationsource',
    );
  });

  it('asks for nothing where no field of the form carries a config', () => {
    expect(aiConfigWidgets(aSet(), 'io').length).toBeGreaterThan(0);
    expect(
      aiConfigWidgets(aSet({ widgets: [{ id: 'cclom:title' }, { id: 'license' }] }), 'io'),
    ).toEqual([]);
  });
});
