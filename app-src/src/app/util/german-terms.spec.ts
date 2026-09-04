import { describe, expect, it } from 'vitest';

import {
  DE_STOPWORDS,
  foldUmlauts,
  normalizeLabel,
  normalizeSlug,
  sharedTerms,
  signalTerms,
  termMatches,
} from './german-terms';

describe('signalTerms', () => {
  it('takes the words of a phrase that can carry a signal', () => {
    expect(signalTerms('Optik und Akustik')).toEqual(['optik', 'akustik']);
  });

  it('drops the stopwords, which are not merely useless but sit inside ordinary words', () => {
    expect(signalTerms('die Studien der Medien')).toEqual(['studien', 'medien']);
    expect(DE_STOPWORDS.has('die')).toBe(true);
  });

  it('drops a single character, which says nothing', () => {
    expect(signalTerms('a Optik b')).toEqual(['optik']);
  });

  it('splits on everything that is not a letter or a digit', () => {
    expect(signalTerms('Licht-Brechung, Klasse 10/11')).toEqual(['licht', 'brechung', 'klasse', '10', '11']);
  });

  it('keeps the letters German writes its words with', () => {
    expect(signalTerms('Übungen für Schüler')).toEqual(['übungen', 'schüler']);
  });

  it('reads a phrase of nothing but stopwords as no signal at all', () => {
    expect(signalTerms('und oder aber')).toEqual([]);
    expect(signalTerms('')).toEqual([]);
  });
});

describe('termMatches', () => {
  it('finds a long term wherever it sits, which is where German puts it', () => {
    expect(termMatches('optik', 'lichtoptikversuche')).toBe(true);
    expect(termMatches('brechung', 'die lichtbrechung')).toBe(true);
  });

  it('finds a short term at the start of a word', () => {
    expect(termMatches('bio', 'biologie und chemie')).toBe(true);
    expect(termMatches('bio', 'biologie')).toBe(true);
    expect(termMatches('bio', 'fach: biologie')).toBe(true);
  });

  it('refuses a short term that only sits inside a word by accident', () => {
    expect(termMatches('bio', 'symbiose')).toBe(false);
    expect(termMatches('kun', 'sekundarstufe')).toBe(false);
  });

  it('finds a short term at a word start even where an accidental hit comes first', () => {
    expect(termMatches('bio', 'symbiose in der biologie')).toBe(true);
  });

  it('answers no where either side is empty', () => {
    expect(termMatches('', 'biologie')).toBe(false);
    expect(termMatches('bio', '')).toBe(false);
  });
});

describe('foldUmlauts', () => {
  it('writes the umlauts and the sharp s as their transcriptions', () => {
    expect(foldUmlauts('übung für schüler, maß')).toBe('uebung fuer schueler, mass');
    expect(foldUmlauts('öl')).toBe('oel');
    expect(foldUmlauts('ähnlich')).toBe('aehnlich');
  });

  it('leaves a text that spells none of them alone', () => {
    expect(foldUmlauts('optik')).toBe('optik');
  });
});

describe('normalizeLabel', () => {
  it('folds two spellings of the same words together', () => {
    expect(normalizeLabel('Sekundarstufe I')).toBe(normalizeLabel('sekundarstufe_i'));
    expect(normalizeLabel('Für Schüler')).toBe(normalizeLabel('fuer schueler'));
  });

  it('makes every run of non-letters a single space and trims what is left', () => {
    expect(normalizeLabel('  Physik,   Astronomie ')).toBe('physik astronomie');
    expect(normalizeLabel('Deutsch-als---Zweitsprache')).toBe('deutsch als zweitsprache');
  });

  it('never shortens a label, so two labels fold together only when they are the same words', () => {
    expect(normalizeLabel('Deutsch')).not.toBe(normalizeLabel('Deutsch als Zweitsprache'));
  });

  it('reads a label that is missing as an empty one', () => {
    expect(normalizeLabel(null)).toBe('');
    expect(normalizeLabel(undefined)).toBe('');
    expect(normalizeLabel('  ')).toBe('');
  });
});

describe('normalizeSlug', () => {
  it('folds a label into the shape a vocabulary URI\'s last segment is written in', () => {
    expect(normalizeSlug('Sekundarstufe I')).toBe('sekundarstufe_i');
    expect(normalizeSlug('Für Schüler')).toBe('fuer_schueler');
    expect(normalizeSlug('Physik, Astronomie')).toBe('physik_astronomie');
  });

  it('reads a label that is missing as an empty slug', () => {
    expect(normalizeSlug(null)).toBe('');
  });
});

describe('sharedTerms', () => {
  it('names the signal words two texts have in common', () => {
    expect(sharedTerms('Optik und Akustik', 'Akustik in der Schule').sort()).toEqual(['akustik']);
  });

  it('names each shared word once, however often it occurs', () => {
    expect(sharedTerms('Brechung, Brechung, Brechung', 'Brechung')).toEqual(['brechung']);
  });

  it('counts only words long enough to mean something on their own', () => {
    expect(sharedTerms('Optik ab Klasse 10', 'Akustik ab Klasse 10')).toEqual(['klasse']);
  });

  it('names nothing where the texts share no subject', () => {
    expect(sharedTerms('Optik', 'Grammatik')).toEqual([]);
  });

  it('names nothing where either text is missing', () => {
    expect(sharedTerms(null, 'Optik')).toEqual([]);
    expect(sharedTerms('Optik', undefined)).toEqual([]);
    expect(sharedTerms('Optik', 'und der die')).toEqual([]);
  });
});
