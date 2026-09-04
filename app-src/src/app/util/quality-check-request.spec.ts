import { describe, expect, it } from 'vitest';
import type { MdsDefinition, MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import { EDITORIAL_CRITERIA_PROPERTY, KNOCKOUT_CRITERIA_WIDGET } from './quality-criteria-values';
import {
  CheckSubject,
  CriterionVerdict,
  EnrichedMetadata,
  QualityCriterion,
  closingInstructionOf,
  criteriaOf,
  criteriaPropertiesOf,
  enrichmentInstructionOf,
  enrichmentPropertiesOf,
  enrichmentOf,
  knockoutSatisfied,
  originGuessOf,
  originInstructionOf,
  originOf,
  proofreadInstructionOf,
  proofreadOf,
  qualityInstructionOf,
  verdictsOf,
} from './quality-check-request';

const VOCABS = 'http://w3id.org/openeduhub/vocabs';

/** The content under check, as the tasks are told about it. */
function aSubject(overrides: Partial<CheckSubject> = {}): CheckSubject {
  return {
    title: 'Optik',
    text: 'Der Artikel selbst.',
    url: 'https://example.org/optik',
    collection: 'Physik Sek I',
    author: 'Ada Lovelace',
    signedIn: 'Ada Lovelace',
    ...overrides,
  };
}

/** A metadata set whose two criteria widgets list the criteria the check judges. */
function aSet(knockout: MdsValue[], editorial: MdsValue[]): MdsDefinition {
  return {
    id: 'mds_oeh',
    name: 'mds_oeh',
    groups: [],
    views: [],
    widgets: [
      { id: KNOCKOUT_CRITERIA_WIDGET, values: knockout },
      { id: EDITORIAL_CRITERIA_PROPERTY, values: editorial },
    ],
    lists: [],
    sorts: [],
  } as unknown as MdsDefinition;
}

const CRITERIA = criteriaOf(
  aSet(
    [
      { id: 'ccm:oeh_quality_criminal_law', caption: 'Strafrecht' },
      { id: 'ccm:oeh_quality_neutralness', caption: 'Neutralität' },
    ],
    [{ id: `${VOCABS}/quality/content_valid`, caption: 'Sachrichtigkeit' }],
  ),
);

/** The verdict on one of them, by caption. */
function aVerdict(caption: string, met: boolean | null, reason = 'Weil.'): CriterionVerdict {
  return { criterion: CRITERIA.find((one) => one.caption === caption)!, met, reason };
}

describe('criteriaOf', () => {
  it('lists the knock-out criteria first, in the order the set does', () => {
    expect(CRITERIA).toEqual([
      { key: 'k1', id: 'ccm:oeh_quality_criminal_law', caption: 'Strafrecht', kind: 'knockout' },
      { key: 'k2', id: 'ccm:oeh_quality_neutralness', caption: 'Neutralität', kind: 'knockout' },
      { key: 'k3', id: `${VOCABS}/quality/content_valid`, caption: 'Sachrichtigkeit', kind: 'editorial' },
    ] satisfies QualityCriterion[]);
  });

  it('numbers the keys across both lists, so no two criteria share one', () => {
    expect(CRITERIA.map((one) => one.key)).toEqual(['k1', 'k2', 'k3']);
    expect(new Set(CRITERIA.map((one) => one.key)).size).toBe(CRITERIA.length);
  });

  it('falls back to the id where the set gives a criterion no caption', () => {
    const [only] = criteriaOf(aSet([{ id: 'ccm:oeh_quality_data_privacy' } as MdsValue], []));
    expect(only.caption).toBe('ccm:oeh_quality_data_privacy');
  });

  it('judges nothing where the set holds no criteria, or no set is loaded', () => {
    expect(criteriaOf(aSet([], []))).toEqual([]);
    expect(criteriaOf(null)).toEqual([]);
    expect(criteriaOf(undefined)).toEqual([]);
  });
});

describe('originOf and originGuessOf', () => {
  it('read the two answers the opening question allows', () => {
    expect(originOf({ origin: 'own' })).toBe('own');
    expect(originOf({ origin: 'external' })).toBe('external');
    expect(originGuessOf({ origin: 'own', guess: 'external' })).toBe('external');
  });

  it('read anything else as no answer, so nothing is derived from a turn that did not say', () => {
    expect(originOf({ origin: 'vielleicht' })).toBeNull();
    expect(originOf({ guess: 'own' })).toBeNull();
    expect(originOf(null)).toBeNull();
    expect(originOf('own')).toBeNull();
    expect(originOf([{ origin: 'own' }])).toBeNull();
    expect(originGuessOf({ origin: 'own' })).toBeNull();
  });
});

describe('proofreadOf', () => {
  it('reads the places the pass named, each with what it is to say instead', () => {
    expect(
      proofreadOf({
        findings: [{ passage: '  der Optik  ', correction: 'die Optik', kind: ' grammar ' }],
        summary: '  Sprachlich sauber.  ',
        decision: 'accepted',
      }),
    ).toEqual({
      findings: [{ passage: 'der Optik', correction: 'die Optik', kind: 'grammar' }],
      summary: 'Sprachlich sauber.',
      decision: 'accepted',
    });
  });

  it('reads an empty list as the pass having answered, since that is the good outcome', () => {
    expect(proofreadOf({ findings: [] })).toEqual({ findings: [], summary: '', decision: null });
  });

  it('reads a turn with no list at all as one about a different question', () => {
    expect(proofreadOf({ summary: 'Alles gut' })).toBeNull();
    expect(proofreadOf({ findings: 'keine' })).toBeNull();
    expect(proofreadOf(null)).toBeNull();
  });

  it('drops a finding that names nothing the person could act on', () => {
    expect(
      proofreadOf({
        findings: [
          { passage: 'der Optik' },
          { correction: 'die Optik' },
          { passage: '  ', correction: 'die Optik' },
          'kein Befund',
          { passage: 'ein Satz', correction: 'ein Satz.' },
        ],
      })!.findings,
    ).toEqual([{ passage: 'ein Satz', correction: 'ein Satz.', kind: '' }]);
  });

  it('reads only the two decisions the person can make; anything else leaves the step open', () => {
    expect(proofreadOf({ findings: [], decision: 'skipped' })!.decision).toBe('skipped');
    expect(proofreadOf({ findings: [], decision: 'open' })!.decision).toBeNull();
    expect(proofreadOf({ findings: [] })!.decision).toBeNull();
  });
});

describe('enrichmentOf', () => {
  const AN_ANSWER = {
    discipline: [{ label: '  Physik  ', uri: `  ${VOCABS}/discipline/460  ` }],
    educationalContext: [],
    lrt: [{ label: 'Arbeitsblatt', uri: `${VOCABS}/new_lrt/03ab835b` }],
    intendedEndUserRole: [],
    keywords: ['  Optik  ', '', 42],
    confirmed: true,
  };

  it('reads each value as its label and the URI the lookup returned', () => {
    expect(enrichmentOf(AN_ANSWER)).toEqual({
      discipline: [{ label: 'Physik', uri: `${VOCABS}/discipline/460` }],
      educationalContext: [],
      lrt: [{ label: 'Arbeitsblatt', uri: `${VOCABS}/new_lrt/03ab835b` }],
      intendedEndUserRole: [],
      keywords: ['Optik'],
      confirmed: true,
    } satisfies EnrichedMetadata);
  });

  it('drops an entry that states neither a name nor a URI', () => {
    expect(enrichmentOf({ discipline: [{}, { label: '' }, { label: 'Physik' }] })!.discipline).toEqual([
      { label: 'Physik', uri: '' },
    ]);
  });

  it('reads a field the turn did not answer as an empty list', () => {
    expect(enrichmentOf({ keywords: ['Optik'] })!.discipline).toEqual([]);
    expect(enrichmentOf({ keywords: ['Optik'], lrt: 'Arbeitsblatt' })!.lrt).toEqual([]);
  });

  it('reads a turn that stated nothing at all as no enrichment, not as one that is empty', () => {
    expect(enrichmentOf({ confirmed: true })).toBeNull();
    expect(enrichmentOf({ discipline: [], keywords: [] })).toBeNull();
    expect(enrichmentOf(null)).toBeNull();
  });

  it('counts only a literal true as the person having confirmed', () => {
    expect(enrichmentOf({ keywords: ['Optik'], confirmed: 'ja' })!.confirmed).toBe(false);
    expect(enrichmentOf({ keywords: ['Optik'] })!.confirmed).toBe(false);
  });
});

describe('enrichmentPropertiesOf', () => {
  /** An enrichment stating the given values and nothing else. */
  function enriched(overrides: Partial<EnrichedMetadata> = {}): EnrichedMetadata {
    return {
      discipline: [],
      educationalContext: [],
      lrt: [],
      intendedEndUserRole: [],
      keywords: [],
      confirmed: true,
      ...overrides,
    };
  }

  it('records each vocabulary value as the URI alone, which is what the property holds', () => {
    expect(
      enrichmentPropertiesOf(
        enriched({ discipline: [{ label: 'Physik', uri: `${VOCABS}/discipline/460` }] }),
        null,
      ),
    ).toEqual({ 'ccm:taxonid': [`${VOCABS}/discipline/460`] });
  });

  it('sends one answered field to two properties, by the vocabulary each value came out of', () => {
    expect(
      enrichmentPropertiesOf(
        enriched({
          lrt: [
            { label: 'Arbeitsblatt', uri: `${VOCABS}/new_lrt/03ab835b` },
            { label: 'Material', uri: `${VOCABS}/new_lrt_aggregated/6b6786df` },
          ],
        }),
        null,
      ),
    ).toEqual({
      'ccm:oeh_lrt': [`${VOCABS}/new_lrt/03ab835b`],
      'ccm:oeh_lrt_aggregated': [`${VOCABS}/new_lrt_aggregated/6b6786df`],
    });
  });

  it('records nothing for a URI out of another vocabulary — it would match nothing where it landed', () => {
    expect(
      enrichmentPropertiesOf(
        enriched({ discipline: [{ label: 'Physik', uri: 'https://example.org/faecher/physik' }] }),
        null,
      ),
    ).toEqual({});
  });

  it('records a value once, however often the lookup answered it', () => {
    const value = { label: 'Physik', uri: `${VOCABS}/discipline/460` };
    expect(
      enrichmentPropertiesOf(enriched({ discipline: [value, { ...value }] }), null)['ccm:taxonid'],
    ).toEqual([`${VOCABS}/discipline/460`]);
  });

  it('adds the keywords to those the content already carries rather than replacing them', () => {
    expect(
      enrichmentPropertiesOf(enriched({ keywords: ['Linsen', 'Brechung'] }), {
        'cclom:general_keyword': ['Optik', 'Brechung'],
      })['cclom:general_keyword'],
    ).toEqual(['Optik', 'Brechung', 'Linsen']);
  });

  it('keeps a shared keyword in the spelling the content already carries', () => {
    expect(
      enrichmentPropertiesOf(enriched({ keywords: ['optik'] }), {
        'cclom:general_keyword': ['Optik'],
      })['cclom:general_keyword'],
    ).toEqual(['Optik']);
  });

  it('records no keywords where neither side has any', () => {
    expect(enrichmentPropertiesOf(enriched(), { 'cclom:general_keyword': ['  '] })).toEqual({});
    expect(enrichmentPropertiesOf(enriched(), null)).toEqual({});
  });
});

describe('verdictsOf', () => {
  it('reads one verdict per criterion, by the key the schema asked it under', () => {
    expect(
      verdictsOf(
        {
          criteria: {
            k1: { outcome: 'met', reason: '  Nichts gefunden.  ' },
            k2: { outcome: 'violated', reason: 'Einseitig.' },
            k3: { outcome: 'unclear', reason: 'Kein Text.' },
          },
          summary: '  Zwei Punkte offen.  ',
          suitable: false,
          confirmed: true,
        },
        CRITERIA,
      ),
    ).toEqual({
      verdicts: [
        { criterion: CRITERIA[0], met: true, reason: 'Nichts gefunden.' },
        { criterion: CRITERIA[1], met: false, reason: 'Einseitig.' },
        { criterion: CRITERIA[2], met: null, reason: 'Kein Text.' },
      ],
      summary: 'Zwei Punkte offen.',
      suitable: false,
      confirmed: true,
    });
  });

  it('drops a criterion answered with anything but one of the three words', () => {
    const read = verdictsOf(
      { criteria: { k1: { outcome: 'vielleicht' }, k2: { reason: 'ohne Urteil' }, k3: 'met' } },
      CRITERIA,
    );
    expect(read.verdicts).toEqual([]);
  });

  it('reads the three words however the turn spelled them', () => {
    const read = verdictsOf({ criteria: { k1: { outcome: '  MET  ' } } }, CRITERIA);
    expect(read.verdicts).toEqual([{ criterion: CRITERIA[0], met: true, reason: '' }]);
  });

  it('says nothing about the overall verdict where the turn did not', () => {
    expect(verdictsOf({ criteria: {} }, CRITERIA).suitable).toBeNull();
    expect(verdictsOf({ criteria: {}, suitable: 'nein' }, CRITERIA).suitable).toBeNull();
    expect(verdictsOf({ criteria: {}, suitable: false }, CRITERIA).suitable).toBe(false);
  });

  it('counts only a literal true as the person having confirmed', () => {
    expect(verdictsOf({ criteria: {}, confirmed: 'ja' }, CRITERIA).confirmed).toBe(false);
  });

  it('reads a turn that answered nothing as a check with no verdicts', () => {
    expect(verdictsOf(null, CRITERIA)).toEqual({
      verdicts: [],
      summary: '',
      suitable: null,
      confirmed: false,
    });
  });
});

describe('criteriaPropertiesOf', () => {
  /** A criterion's widget: a plain yes/no valuespace, or one that states a machine's all-clear. */
  function widgets(withAutoMet = false): MdsWidget[] {
    return [
      {
        id: 'ccm:oeh_quality_criminal_law',
        values: [
          ...(withAutoMet ? [{ id: `${VOCABS}/quality/no_auto_findings` }] : []),
          { id: '1' },
          { id: '0' },
        ],
      },
      { id: 'ccm:oeh_quality_neutralness', values: [{ id: '1' }, { id: '0' }] },
    ] as unknown as MdsWidget[];
  }

  it('records a met knock-out criterion as the machine\'s all-clear where the vocabulary states one', () => {
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', true)], widgets(true), null)).toEqual({
      'ccm:oeh_quality_criminal_law': [`${VOCABS}/quality/no_auto_findings`],
    });
  });

  it('records it as the plain met value where the vocabulary states no such term', () => {
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', true)], widgets(), null)).toEqual({
      'ccm:oeh_quality_criminal_law': ['1'],
    });
  });

  it('records a violated criterion as the violated value, all-clear or no', () => {
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', false)], widgets(true), null)).toEqual({
      'ccm:oeh_quality_criminal_law': ['0'],
    });
  });

  it('records nothing for a criterion the check could not decide', () => {
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', null)], widgets(), null)).toEqual({});
  });

  it('records nothing where the vocabulary holds no value for what the verdict means', () => {
    const unmapped = [{ id: 'ccm:oeh_quality_criminal_law', values: [] }] as unknown as MdsWidget[];
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', true)], unmapped, null)).toEqual({});
    expect(criteriaPropertiesOf([aVerdict('Strafrecht', true)], undefined, null)).toEqual({});
  });

  it('adds a met editorial criterion to the shared list, and takes a violated one off it', () => {
    expect(
      criteriaPropertiesOf([aVerdict('Sachrichtigkeit', true)], widgets(), null)[
        EDITORIAL_CRITERIA_PROPERTY
      ],
    ).toEqual([`${VOCABS}/quality/content_valid`]);

    expect(
      criteriaPropertiesOf([aVerdict('Sachrichtigkeit', false)], widgets(), {
        [EDITORIAL_CRITERIA_PROPERTY]: [`${VOCABS}/quality/content_valid`, 'anderes'],
      })[EDITORIAL_CRITERIA_PROPERTY],
    ).toEqual(['anderes']);
  });

  it('leaves the editorial list untouched where no editorial criterion was judged', () => {
    expect(
      criteriaPropertiesOf([aVerdict('Strafrecht', true)], widgets(), {
        [EDITORIAL_CRITERIA_PROPERTY]: ['anderes'],
      }),
    ).not.toHaveProperty(EDITORIAL_CRITERIA_PROPERTY);
  });

  it('records nothing at all for a check that reached no verdict', () => {
    expect(criteriaPropertiesOf([], widgets(), null)).toEqual({});
  });
});

describe('knockoutSatisfied', () => {
  it('clears the way once every knock-out criterion is judged and judged met', () => {
    expect(
      knockoutSatisfied([aVerdict('Strafrecht', true), aVerdict('Neutralität', true)], CRITERIA),
    ).toBe(true);
  });

  it('is held back by a knock-out criterion nobody answered', () => {
    expect(knockoutSatisfied([aVerdict('Strafrecht', true)], CRITERIA)).toBe(false);
  });

  it('is held back by one answered as undecided, and by one answered as violated', () => {
    expect(
      knockoutSatisfied([aVerdict('Strafrecht', true), aVerdict('Neutralität', null)], CRITERIA),
    ).toBe(false);
    expect(
      knockoutSatisfied([aVerdict('Strafrecht', true), aVerdict('Neutralität', false)], CRITERIA),
    ).toBe(false);
  });

  it('is not cleared by the editorial criteria, which do not gate the confirmation', () => {
    expect(knockoutSatisfied([aVerdict('Sachrichtigkeit', true)], CRITERIA)).toBe(false);
  });

  it('is held back by a set that names no knock-out criterion at all', () => {
    expect(knockoutSatisfied([], [])).toBe(false);
  });
});

/**
 * The tasks themselves, as one recorded dump over every branch that changes them.
 *
 * They are long German texts whose wording is the behaviour, so a `toContain` per sentence would pin the
 * sentences somebody thought of and nothing else. What is asserted here instead is the whole outgoing text:
 * a change to any of it shows up as a diff, and `npm --prefix app-src run test -- -u` records the new
 * wording once it is meant. The couplings inside those texts — the chip labels, the verdict glyphs, the
 * footer's own label — are pinned as assertions in `ai-prompts.spec.ts`.
 */
describe('the tasks as they go out', () => {
  /** Every state of the content that changes what a task says about where its text stands. */
  const CONTENTS: Record<string, Partial<CheckSubject>> = {
    'text in full': { text: 'Der Artikel selbst.' },
    'text cut, page readable': { text: 'x'.repeat(20_001) },
    'text cut, no page to read': { text: 'x'.repeat(20_001), url: null },
    'no text, page readable': { text: '   ' },
    'no text, no page to read': { text: '   ', url: null },
  };

  /** Every state of the surroundings that changes what a task names. */
  const SUBJECTS: Record<string, Partial<CheckSubject>> = {
    'in a collection': {},
    'outside a collection': { collection: null },
    'nameless content, nothing known about it': {
      title: null,
      collection: null,
      url: null,
      author: null,
      signedIn: null,
    },
  };

  it('are what they were recorded as', async () => {
    const sections: string[] = [];
    const section = (name: string, task: string) =>
      sections.push(`${'='.repeat(96)}\n== ${name}\n${'='.repeat(96)}\n${task}`);

    for (const [surroundings, overrides] of Object.entries(SUBJECTS)) {
      const subject = aSubject(overrides);
      section(`origin — ${surroundings}`, originInstructionOf(subject));
      section(`enrichment — ${surroundings}`, enrichmentInstructionOf(subject));
      section(`closing — ${surroundings}`, closingInstructionOf(subject));

      for (const [state, content] of Object.entries(CONTENTS)) {
        const of = aSubject({ ...overrides, ...content });
        section(`proofread — ${surroundings}, ${state}`, proofreadInstructionOf(of));
        section(`quality — ${surroundings}, ${state}`, qualityInstructionOf(CRITERIA, of));
      }
    }

    await expect(sections.join('\n\n')).toMatchFileSnapshot('./__snapshots__/quality-check-request.txt');
  });

  it('carry no blank line twice over, however many of their lines are switched off', () => {
    const task = qualityInstructionOf(CRITERIA, aSubject({ collection: null }));
    expect(task).not.toContain('\n\n\n');
    expect(proofreadInstructionOf(aSubject({ collection: null }))).not.toContain('\n\n\n');
    expect(enrichmentInstructionOf(aSubject({ collection: null }))).not.toContain('\n\n\n');
  });

  it('close on the reminder, which is the last thing the run reads', () => {
    expect(qualityInstructionOf(CRITERIA, aSubject())).toContain('Zur Erinnerung, bevor du antwortest');
    expect(proofreadInstructionOf(aSubject())).toContain('Zur Erinnerung, bevor du antwortest');
    expect(enrichmentInstructionOf(aSubject())).not.toContain('Zur Erinnerung');
  });

  it('never carry the content\'s own text, which travels in the page context instead', () => {
    const text = 'Ein sehr eigener Wortlaut, der nirgends in der Aufgabe stehen darf.';
    expect(qualityInstructionOf(CRITERIA, aSubject({ text }))).not.toContain(text);
    expect(proofreadInstructionOf(aSubject({ text }))).not.toContain(text);
  });

  it('never state the page\'s address, which the context and the text both name already', () => {
    const url = 'https://example.org/eine-ganz-bestimmte-adresse';
    expect(qualityInstructionOf(CRITERIA, aSubject({ url }))).not.toContain(url);
    // The opening question is the exception: the guess is made from what is known, and it is listed.
    expect(originInstructionOf(aSubject({ url }))).toContain(url);
  });
});
