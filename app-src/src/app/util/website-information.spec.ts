import { describe, expect, it } from 'vitest';
import type { WebsiteInformation } from 'ngx-edu-sharing-api';

import { describesSamePage, websiteInformationFields } from './website-information';

/** What the repository answers for an address it could read. */
function anAnswer(overrides: Partial<WebsiteInformation> = {}): WebsiteInformation {
  return {
    title: 'Bruchrechnung üben',
    description: 'Aufgaben zur Bruchrechnung mit Lösungen für die Sekundarstufe.',
    keywords: ['Bruchrechnung', 'Aufgaben'],
    ...overrides,
  };
}

describe('describesSamePage', () => {
  it('accepts an answer that shares a word with the page’s title', () => {
    expect(describesSamePage(anAnswer(), 'Bruchrechnung für Klasse 6')).toBe(true);
  });

  it('refuses the login page the repository sees instead of the content', () => {
    const wall = anAnswer({
      title: 'Anmeldung — Mein Konto',
      description: 'Bitte melden Sie sich an, um fortzufahren.',
      keywords: [],
    });
    expect(describesSamePage(wall, 'Bruchrechnung üben', 'Ein Bruch besteht aus Zähler und Nenner.')).toBe(false);
  });

  it('accepts an answer whose description is evidently about the page’s text', () => {
    const info = anAnswer({ title: undefined });
    expect(
      describesSamePage(
        info,
        'Rechnen',
        'Bruchrechnung: Aufgaben mit Lösungen, Sekundarstufe. Weitere Aufgaben folgen.',
      ),
    ).toBe(true);
  });

  it('refuses an answer that states nothing — there is nothing in it to use', () => {
    expect(describesSamePage(anAnswer({ title: '', description: '' }), 'Bruchrechnung')).toBe(false);
    expect(describesSamePage(null, 'Bruchrechnung')).toBe(false);
  });
});

describe('websiteInformationFields', () => {
  it('takes the description and the keywords, and states them as read rather than derived', () => {
    const fields = websiteInformationFields(anAnswer());
    expect(fields.map((field) => field.property)).toEqual([
      'cclom:general_description',
      'cclom:general_keyword',
    ]);
    expect(fields.every((field) => field.standing === 'stated' && field.source === 'website-info')).toBe(true);
  });

  it('leaves the title and the licence to the page and the licence mapping', () => {
    const fields = websiteInformationFields(anAnswer({ license: 'CC BY-SA 4.0' }));
    expect(fields.some((field) => field.property === 'cclom:title')).toBe(false);
    expect(fields.some((field) => field.property.startsWith('ccm:commonlicense'))).toBe(false);
  });

  it('contributes nothing for an answer that carries nothing', () => {
    expect(websiteInformationFields({ duplicateNodes: [] })).toEqual([]);
    expect(websiteInformationFields(null)).toEqual([]);
  });
});
