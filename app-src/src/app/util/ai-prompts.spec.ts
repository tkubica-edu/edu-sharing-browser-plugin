import { describe, expect, it } from 'vitest';

import { AI_PROMPTS, AI_REPLIES } from './ai-prompts';
import { VOCABULARY_FIELD_NAMES } from './ai-schemas';
import { installChatOverrides } from './chat-overrides';
import type { CheckSubject, QualityCriterion } from './quality-check-request';

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

const CRITERIA = [
  { key: 'k1', id: 'ccm:oeh_quality_neutralness', caption: 'Neutralität' },
  { key: 'k2', id: 'content_valid', caption: 'Sachrichtigkeit' },
] as QualityCriterion[];

/** One task as the one text it is sent as. */
function textOf(lines: readonly string[]): string {
  return lines.join('\n');
}

describe('AI_REPLIES', () => {
  it('offers two answers per step, in the order they are shown', () => {
    for (const replies of Object.values(AI_REPLIES)) expect(replies).toHaveLength(2);
  });

  it('is quoted verbatim by the task of its step, so the buttons and the sentence are one text', () => {
    const tasks: Record<keyof typeof AI_REPLIES, string> = {
      origin: textOf(AI_PROMPTS.origin(aSubject())),
      proofread: textOf(AI_PROMPTS.proofread(aSubject())),
      quality: textOf(AI_PROMPTS.quality(CRITERIA, aSubject())),
      enrichment: textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline'])),
    };
    for (const [step, replies] of Object.entries(AI_REPLIES)) {
      for (const label of replies) {
        expect(tasks[step as keyof typeof AI_REPLIES]).toContain(`„${label}“`);
      }
    }
  });
});

describe('AI_PROMPTS.origin', () => {
  it('names the content and states what is coming', () => {
    const task = textOf(AI_PROMPTS.origin(aSubject()));
    expect(task).toContain('den Inhalt „Optik“');
    expect(task).toContain('Qualitätsprüfung');
  });

  it('speaks of a content with no title without naming one', () => {
    const task = textOf(AI_PROMPTS.origin(aSubject({ title: null })));
    expect(task).toContain('diesen Inhalt');
    expect(task).not.toContain('den Inhalt „');
  });

  it('states what is known for the guess, and says so where nothing is', () => {
    expect(textOf(AI_PROMPTS.origin(aSubject()))).toContain('- Quelle: https://example.org/optik');
    const blank = textOf(AI_PROMPTS.origin(aSubject({ url: null, author: null, signedIn: null })));
    expect(blank).toContain('- Quelle: nicht bekannt');
    expect(blank).toContain('- als Urheber genannt: niemand');
    expect(blank).toContain('- angemeldet ist: unbekannt');
  });

  it('holds the answer back until the person has given one', () => {
    const task = textOf(AI_PROMPTS.origin(aSubject()));
    expect(task).toContain('Rufe submit_result ERST auf, wenn sie geantwortet hat');
    expect(task).toContain('origin="own"');
    expect(task).toContain('origin="external"');
  });
});

describe('AI_PROMPTS.proofread', () => {
  it('points the pass at the skills of the collection, where there is one', () => {
    expect(textOf(AI_PROMPTS.proofread(aSubject()))).toContain('get_skill_registry');
  });

  it('keeps the line for that as an empty one where there is no collection', () => {
    const lines = AI_PROMPTS.proofread(aSubject({ collection: null }));
    expect(textOf(lines)).not.toContain('get_skill_registry');
    // An entry switched off reads as '' rather than being dropped — the blank lines of the outgoing
    // task are entries of this table, and the caller keeps the ones whose predecessor is filled.
    expect(lines).toContain('');
    expect(lines).toHaveLength(AI_PROMPTS.proofread(aSubject()).length);
  });

  it('keeps the pass off the subject matter, which the criteria judge', () => {
    const task = textOf(AI_PROMPTS.proofread(aSubject()));
    expect(task).toContain('Es geht allein um die Sprache');
    expect(task).toContain('Sachrichtigkeit');
  });

  it('says the assistant changes nothing itself, so no correction is reported as made', () => {
    expect(textOf(AI_PROMPTS.proofread(aSubject()))).toContain('Du selbst änderst am Inhalt nichts');
  });

  it('says an empty list is a result', () => {
    expect(textOf(AI_PROMPTS.proofread(aSubject()))).toContain('auch das ist ein Ergebnis');
  });
});

describe('AI_PROMPTS.quality', () => {
  it('lists every criterion by the key the answer is mapped back on, with its caption', () => {
    const task = textOf(AI_PROMPTS.quality(CRITERIA, aSubject()));
    expect(task).toContain('k1: Neutralität');
    expect(task).toContain('k2: Sachrichtigkeit');
  });

  it('names the collection the content is measured against, and the content itself', () => {
    expect(textOf(AI_PROMPTS.quality(CRITERIA, aSubject()))).toContain(
      'dem Inhalt „Optik“ für die Sammlung „Physik Sek I“',
    );
    expect(textOf(AI_PROMPTS.quality(CRITERIA, aSubject({ title: null, collection: null })))).toContain(
      'dem Inhalt der aktuellen Seite',
    );
  });

  it('says the subject is this one content and not the collection around it', () => {
    expect(textOf(AI_PROMPTS.quality(CRITERIA, aSubject()))).toContain(
      'Beurteile NICHT die übrigen Inhalte der Sammlung',
    );
  });

  it('offers the three verdicts the schema offers', () => {
    const task = textOf(AI_PROMPTS.quality(CRITERIA, aSubject()));
    for (const outcome of ['met', 'violated', 'unclear']) expect(task).toContain(`„${outcome}“`);
  });

  it('asks the verdict lines for the glyphs the panel colours them by', () => {
    const task = textOf(AI_PROMPTS.quality(CRITERIA, aSubject()));
    const asked = ['✓', '✗', '○'].filter((glyph) => task.includes(glyph));
    expect(asked).toEqual(['✓', '✗', '○']);

    // The coupling itself: a line beginning with a glyph the task asks for is one `chat-overrides.ts`
    // gives a verdict class to. Asking for another glyph would leave the verdicts uncoloured.
    for (const glyph of asked) {
      const element = document.createElement('div');
      document.body.appendChild(element);
      element.attachShadow({ mode: 'open' }).innerHTML =
        `<div class="messages-area"><div class="message-row bot-row"><div class="msg-content">` +
        `<p>${glyph} <strong>Neutralität</strong></p></div></div></div>`;
      installChatOverrides(element);
      expect(element.shadowRoot!.querySelector('strong')!.className).toMatch(/^es-verdict-/);
      element.remove();
    }
  });

  it('says a verdict of "not suitable" is a complete answer rather than an open step', () => {
    const task = textOf(AI_PROMPTS.quality(CRITERIA, aSubject()));
    expect(task).toContain('confirmed=true und suitable=false');
  });

  it('points at the collection\'s skills only where there is a collection', () => {
    expect(textOf(AI_PROMPTS.quality(CRITERIA, aSubject()))).toContain('get_skill_registry');
    expect(textOf(AI_PROMPTS.quality(CRITERIA, aSubject({ collection: null })))).not.toContain(
      'get_skill_registry',
    );
  });
});

describe('AI_PROMPTS.enrichment', () => {
  it('asks the vocabularies by name, enumerated as one German sentence', () => {
    expect(textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline', 'lrt']))).toContain(
      'vocabulary="discipline" und "lrt"',
    );
    expect(
      textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline', 'educationalContext', 'lrt'])),
    ).toContain('vocabulary="discipline", "educationalContext" und "lrt"');
  });

  it('asks for the four fields the schema answers, spelled the way the lookup takes them', () => {
    expect(textOf(AI_PROMPTS.enrichment(aSubject(), VOCABULARY_FIELD_NAMES))).toContain(
      'vocabulary="discipline", "educationalContext", "lrt" und "intendedEndUserRole"',
    );
  });

  it('DEFECT: a list of one vocabulary comes out with a dangling „und"', () => {
    // `askedVocabularies` joins "all but the last" with "the last", and for one name the first half
    // is empty — the sentence then reads `vocabulary= und "discipline"`. Latent: the only caller
    // passes VOCABULARY_FIELD_NAMES, which is four. Delete this test with the fix.
    expect(textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline']))).toContain(
      'vocabulary= und "discipline"',
    );
  });

  it('asks for the URI the lookup returned and forbids forming one', () => {
    const task = textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline']));
    expect(task).toContain('Bilde keine URI selbst');
    expect(task).toContain('lookup_wlo_vocabulary');
  });

  it('asks for every value of a field rather than the first', () => {
    expect(textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline']))).toContain(
      'Jedes dieser vier Felder ist eine Liste',
    );
  });

  it('drops the collection line entirely where there is none, rather than leaving it blank', () => {
    const withCollection = AI_PROMPTS.enrichment(aSubject(), ['discipline']);
    const without = AI_PROMPTS.enrichment(aSubject({ collection: null }), ['discipline']);
    expect(without).toHaveLength(withCollection.length - 1);
    expect(textOf(without)).not.toContain('get_skill_registry');
  });

  it('says the submit_result call is the saving, so no saving is announced as still to come', () => {
    const task = textOf(AI_PROMPTS.enrichment(aSubject(), ['discipline']));
    expect(task).toContain('Dieser Aufruf IST das Speichern');
    expect(task).toContain('kündige kein Speichern an');
  });
});

describe('AI_PROMPTS.closing', () => {
  it('names the footer the person is sent to, by the label the footer carries', () => {
    // `action-bar.service.ts` labels that action; the task names it in words.
    expect(textOf(AI_PROMPTS.closing(aSubject()))).toContain('Abschließen und zur Inhaltsübersicht');
  });

  it('asks for nothing back — no question, no submit_result', () => {
    const task = textOf(AI_PROMPTS.closing(aSubject()));
    expect(task).toContain('Stell keine Frage mehr');
    expect(task).toContain('rufe submit_result nicht auf');
  });

  it('names the content that was checked', () => {
    expect(textOf(AI_PROMPTS.closing(aSubject()))).toContain('Prüfung von „Optik“');
    expect(textOf(AI_PROMPTS.closing(aSubject({ title: null })))).toContain('Prüfung von diesem Inhalt');
  });
});

describe('the reminders that close a task', () => {
  it('open with a rule and a separator, so they read as the last thing before the answer', () => {
    for (const reminder of [AI_PROMPTS.proofreadReminder, AI_PROMPTS.qualityReminder]) {
      expect(reminder[0]).toBe('');
      expect(reminder[1]).toBe('---');
      expect(reminder[2]).toContain('Zur Erinnerung');
    }
  });

  it('repeat the one rule each step turns on: the call comes after the person answers', () => {
    expect(textOf(AI_PROMPTS.proofreadReminder)).toContain('Rufe submit_result in diesem Zug nicht auf');
    expect(textOf(AI_PROMPTS.qualityReminder)).toContain('Rufe submit_result in diesem Zug nicht auf');
  });
});

describe('AI_PROMPTS.content', () => {
  it('points at the wording rather than quoting it, since the text travels in the page context', () => {
    expect(AI_PROMPTS.content.inContext).toContain('Seitenkontext');
    expect(AI_PROMPTS.content.truncated).toContain('abgeschnitten');
  });

  it('offers reading the page only where that is worth asking for', () => {
    expect(AI_PROMPTS.content.truncatedFetch).toContain('get_url_text');
    expect(AI_PROMPTS.content.missingFetch).toContain('get_url_text');
    expect(AI_PROMPTS.content.missingNoFetch).not.toContain('get_url_text');
  });

  it('tells the check what a criterion means without a text, where there is no reading it', () => {
    expect(AI_PROMPTS.content.missingNoFetch).toContain('nicht prüfbar');
  });
});
