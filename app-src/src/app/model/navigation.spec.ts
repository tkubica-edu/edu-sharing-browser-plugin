import { describe, expect, it } from 'vitest';

import { AppSection, Conditions, SECTIONS, SectionId, sectionText } from './navigation';

/** A world in which nothing applies — the state the panel starts in before anything is known. */
function noConditions(overrides: Partial<Conditions> = {}): Conditions {
  return {
    onlyOfficePresent: false,
    onEduSharing: false,
    loggedIn: false,
    hasSession: false,
    hasActiveNode: false,
    hasDetectedNode: false,
    hasEditableMetadata: false,
    hasCuratedContent: false,
    recognizingContent: false,
    browserExtensionCustomWebComponent: false,
    nostrEnabled: false,
    qualityCriteriaMet: false,
    agentEditWindowClosed: false,
    ...overrides,
  };
}

/** A signed-in user on an ordinary page, with the repository's own web component enabled. */
function signedIn(overrides: Partial<Conditions> = {}): Conditions {
  return noConditions({
    loggedIn: true,
    hasSession: true,
    browserExtensionCustomWebComponent: true,
    ...overrides,
  });
}

/** The section under this id — every assertion below names the section it is about. */
function section(id: SectionId): AppSection {
  return SECTIONS.find((one) => one.id === id)!;
}

/** Which sections answer to these conditions. */
function visible(conditions: Conditions): SectionId[] {
  return SECTIONS.filter((one) => one.visible(conditions)).map((one) => one.id);
}

describe('sectionText', () => {
  it('reads a text that is one', () => {
    expect(sectionText('Einstellungen', noConditions())).toBe('Einstellungen');
  });

  it('reads a text that names its own state against the conditions that hold', () => {
    expect(sectionText((c) => (c.loggedIn ? 'angemeldet' : 'nicht angemeldet'), signedIn())).toBe(
      'angemeldet',
    );
  });
});

describe('the registry itself', () => {
  it('names every section once', () => {
    expect(new Set(SECTIONS.map((one) => one.id)).size).toBe(SECTIONS.length);
  });

  it('gives every section at least one tab, since a section is entered through one', () => {
    for (const one of SECTIONS) expect(one.tabs.length).toBeGreaterThan(0);
  });

  it('names every tab of a section once', () => {
    for (const one of SECTIONS) {
      expect(new Set(one.tabs.map((tab) => tab.id)).size).toBe(one.tabs.length);
    }
  });

  it('gives every disabled section a reason, since a disabled row cannot show a tooltip', () => {
    for (const one of SECTIONS) {
      if (one.enabled) expect(one.disabledHint).toBeDefined();
    }
    for (const one of SECTIONS) {
      for (const tab of one.tabs) if (tab.enabled) expect(tab.disabledHint).toBeDefined();
    }
  });
});

describe('what is offered before a login', () => {
  it('offers the login and the settings, and nothing else', () => {
    expect(visible(noConditions())).toEqual(['login', 'settings']);
  });

  it('stops offering the login once there is a session of one\'s own', () => {
    expect(visible(noConditions({ hasSession: true }))).toEqual(['settings']);
  });

  it('offers the settings in every state, being about the panel rather than about a content', () => {
    expect(section('settings').visible(noConditions())).toBe(true);
    expect(section('settings').topbar).toBe(true);
  });

  it('offers the login to a guest, who may sign in although nothing demands it', () => {
    // `loggedIn` without `hasSession` is the guest the web component brings.
    expect(visible(noConditions({ loggedIn: true }))).toContain('login');
  });
});

describe('what a signed-in user is offered', () => {
  it('lists the menu entries once logged in', () => {
    expect(visible(signedIn())).toEqual(
      expect.arrayContaining(['content-options', 'add-content', 'curation', 'own-content', 'history']),
    );
  });

  it('offers the assistant only where the repository\'s own web component is on', () => {
    expect(section('ai-assistant').visible(signedIn())).toBe(true);
    expect(
      section('ai-assistant').visible(signedIn({ browserExtensionCustomWebComponent: false })),
    ).toBe(false);
  });

  it('offers inserting a content only on a page that can take one', () => {
    expect(section('search').visible(signedIn())).toBe(false);
    expect(section('search').visible(signedIn({ onlyOfficePresent: true }))).toBe(true);
  });
});

describe('the recognition\'s report — Inhaltsoptionen', () => {
  const options = section('content-options');

  it('names the finding while the recognition is still running', () => {
    const running = signedIn({ recognizingContent: true });
    expect(sectionText(options.label, running)).toBe('Geöffneter Inhalt wird erkannt …');
    expect(options.loading!(running)).toBe(true);
    expect(options.enabled!(running)).toBe(false);
  });

  it('names it once the recognition has answered that there is none', () => {
    const none = signedIn();
    expect(sectionText(options.label, none)).toBe('Kein Inhalt erkannt');
    expect(options.loading!(none)).toBe(false);
    expect(sectionText(options.disabledHint as never, none)).toContain('Inhalt erschließen');
  });

  it('names it once a content was found, and lets the row be entered', () => {
    const found = signedIn({ hasActiveNode: true });
    expect(sectionText(options.label, found)).toBe('Inhalt erkannt');
    expect(options.enabled!(found)).toBe(true);
  });

  it('is the menu\'s centre, whatever it reports', () => {
    expect(options.focal).toBe(true);
    expect(options.menu).toBe(true);
  });
});

describe('Inhalt erschließen', () => {
  const curation = section('curation');

  it('is offered on an ordinary page the repository holds nothing for', () => {
    expect(curation.enabled!(signedIn())).toBe(true);
  });

  it('is held back on the repository\'s own pages, and says why', () => {
    const here = signedIn({ onEduSharing: true });
    expect(curation.enabled!(here)).toBe(false);
    expect(sectionText(curation.disabledHint as never, here)).toContain('Edu-Sharing-Seiten');
  });

  it('is held back for a page already erschlossen, and points at where it is offered', () => {
    const known = signedIn({ hasDetectedNode: true });
    expect(curation.enabled!(known)).toBe(false);
    expect(sectionText(curation.disabledHint as never, known)).toContain('Inhalt erkannt');
  });

  it('is held back while the recognition has not answered which of the two this page is', () => {
    const running = signedIn({ recognizingContent: true });
    expect(curation.enabled!(running)).toBe(false);
    expect(sectionText(curation.disabledHint as never, running)).toContain('geprüft');
  });

  it('is never returned to, because entering it starts the Erschließung', () => {
    expect(curation.oneWay).toBe(true);
    expect(section('new-document').oneWay).toBe(true);
  });
});

describe('the steps a guest session may not carry out', () => {
  it('puts the login in front of the ones that act as a person', () => {
    expect(section('add-content').requiresSession).toBe(true);
    expect(section('own-content').requiresSession).toBe(true);
  });

  it('puts it in front of the writing steps only for a content past its editing window', () => {
    for (const id of ['editorial-forward', 'select-collection', 'quality'] as const) {
      const gate = section(id).requiresSession as (c: Conditions) => boolean;
      expect(gate(signedIn())).toBe(false);
      expect(gate(signedIn({ agentEditWindowClosed: true }))).toBe(true);
    }
  });

  it('asks nothing of a step that writes nothing to the repository', () => {
    expect(section('nostr-forward').requiresSession).toBeUndefined();
    expect(section('history').requiresSession).toBeUndefined();
  });
});

describe('the steps of the content flow', () => {
  /** Metadata that can be edited — a run that answered, saved or not. */
  const editable = (overrides: Partial<Conditions> = {}) =>
    signedIn({ hasEditableMetadata: true, ...overrides });

  it('opens the quality step on a result that has no node yet', () => {
    expect(section('quality').visible(editable())).toBe(true);
    expect(section('quality').visible(signedIn())).toBe(false);
  });

  it('shows the Qualität view only where the repository\'s own web component is on', () => {
    const [quality] = section('quality').tabs;
    expect(quality.visible!(editable())).toBe(true);
    expect(quality.visible!(editable({ browserExtensionCustomWebComponent: false }))).toBe(false);
  });

  it('keeps the Metadaten view visible and disabled until the criteria are answered', () => {
    const metadata = section('quality').tabs[1];
    expect(metadata.visible).toBeUndefined();
    expect(metadata.enabled!(editable())).toBe(false);
    expect(metadata.enabled!(editable({ qualityCriteriaMet: true }))).toBe(true);
    expect(metadata.disabledHint).toContain('Kriterien');
  });

  it('opens the Metadaten view straight away where there is no Qualität view to pass', () => {
    const metadata = section('quality').tabs[1];
    expect(metadata.enabled!(editable({ browserExtensionCustomWebComponent: false }))).toBe(true);
  });

  it('offers the forwarding while either of its two targets applies', () => {
    const forward = section('editorial-forward');
    expect(forward.visible(editable())).toBe(true);
    expect(
      forward.visible(editable({ browserExtensionCustomWebComponent: false, nostrEnabled: true })),
    ).toBe(true);
    expect(forward.visible(editable({ browserExtensionCustomWebComponent: false }))).toBe(false);
  });

  it('offers the choice of check only where there are two checks to choose between', () => {
    expect(section('flow-choice').visible(editable())).toBe(true);
    expect(section('flow-choice').visible(editable({ browserExtensionCustomWebComponent: false }))).toBe(
      false,
    );
  });

  it('offers publishing to the relay for a saved content, and only with the switch on', () => {
    const forward = section('nostr-forward');
    expect(forward.visible(signedIn({ hasActiveNode: true, nostrEnabled: true }))).toBe(true);
    expect(forward.visible(signedIn({ hasActiveNode: true }))).toBe(false);
    expect(forward.visible(editable({ nostrEnabled: true }))).toBe(false);
  });

  it('offers the personal storage only to a session that has one', () => {
    const storage = section('personal-storage');
    expect(storage.visible(editable())).toBe(true);
    expect(storage.visible(editable({ hasSession: false }))).toBe(false);
  });

  it('reports the interactions while either half has something to say', () => {
    const interactions = section('overview').tabs.find((tab) => tab.id === 'interactions')!;
    expect(interactions.visible!(signedIn())).toBe(true);
    expect(interactions.visible!(signedIn({ browserExtensionCustomWebComponent: false }))).toBe(false);
    expect(
      interactions.visible!(signedIn({ browserExtensionCustomWebComponent: false, nostrEnabled: true })),
    ).toBe(true);
  });

  it('opens the Inhaltsübersicht on a content that was written', () => {
    expect(section('overview').visible(signedIn({ hasActiveNode: true }))).toBe(true);
    expect(section('overview').visible(editable())).toBe(false);
  });
});
