import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthFake,
  CurationFake,
  DebugFake,
  FAKE_REPOSITORY_URL,
  WebComponentFake,
  fakeAuth,
  fakeCuration,
  fakeDebug,
  fakeWebComponent,
} from '../../testing/fakes';

describe('ConditionsService', () => {
  let conditions: ConditionsService;
  let auth: AuthFake;
  let curation: CurationFake;
  let debug: DebugFake;
  let webComponent: WebComponentFake;

  beforeEach(() => {
    auth = fakeAuth();
    curation = fakeCuration();
    debug = fakeDebug();
    webComponent = fakeWebComponent();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(CurationService, curation.fake),
        provideFake(DebugService, debug.fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
      ],
    });
    conditions = TestBed.inject(ConditionsService);
  });

  describe('onlyOfficePresent', () => {
    it('recognises the editor as the repository opens it', () => {
      conditions.activeUrl.set(`${FAKE_REPOSITORY_URL}/src/tools/onlyoffice/index.html?nodeId=1`);

      expect(conditions.onlyOfficePresent()).toBe(true);
    });

    it('recognises the standalone integration', () => {
      conditions.activeUrl.set('https://office.example/eduservlet/connector?id=7');

      expect(conditions.onlyOfficePresent()).toBe(true);
    });

    it('leaves a page that merely talks about OnlyOffice a page like any other', () => {
      conditions.activeUrl.set('https://onlyoffice.example/blog?q=/src/tools/onlyoffice');

      // Matched on the path alone: neither the host nor the query names an insert host.
      expect(conditions.onlyOfficePresent()).toBe(false);
    });

    it('counts any page as an insert host while the debug mode simulates one', () => {
      conditions.activeUrl.set('https://example.org/article');
      debug.fake.enabled.set(true);

      expect(conditions.onlyOfficePresent()).toBe(true);
    });

    it('is false for a URL that cannot be parsed, and before one arrives', () => {
      expect(conditions.activeUrl()).toBeNull();
      expect(conditions.onlyOfficePresent()).toBe(false);

      conditions.activeUrl.set('not an address');

      expect(conditions.onlyOfficePresent()).toBe(false);
    });
  });

  describe('onEduSharing', () => {
    it('recognises the configured repository by its host', () => {
      conditions.activeUrl.set('https://repo.example/anything/else');

      expect(conditions.onEduSharing()).toBe(true);
    });

    it('recognises a foreign host that serves edu-sharing under its path', () => {
      conditions.activeUrl.set('https://other.example/edu-sharing/components/workspace');

      expect(conditions.onEduSharing()).toBe(true);
    });

    it('is false for an ordinary page', () => {
      conditions.activeUrl.set('https://example.org/article');

      expect(conditions.onEduSharing()).toBe(false);
    });

    it('does not treat an unconfigured repository as a match for every page', () => {
      auth.fake.repositoryUrl.set('');
      conditions.activeUrl.set('https://example.org/article');

      expect(conditions.onEduSharing()).toBe(false);
    });
  });

  it('leaves it open what the page shows until something answers', () => {
    expect(conditions.recognizingContent()).toBe(true);
  });

  it('reports the gate every feature is behind, not the plain session flag', () => {
    // A repository with the custom web component enabled brings its own session: the panel is
    // authorized while there is no login to make, and the two questions must not collapse into one.
    auth.authorizeWithoutSession();

    expect(conditions.loggedIn()).toBe(true);
    expect(conditions.hasSession()).toBe(false);
  });

  it('reports both as true for a session of the user\'s own', () => {
    auth.signIn();

    expect(conditions.loggedIn()).toBe(true);
    expect(conditions.hasSession()).toBe(true);
  });

  it('reports an active node whatever way it arrived, and a detected one apart', () => {
    expect(conditions.hasActiveNode()).toBe(false);
    expect(conditions.hasDetectedNode()).toBe(false);

    curation.detect('node-7');

    expect(conditions.hasActiveNode()).toBe(true);
    expect(conditions.hasDetectedNode()).toBe(true);
  });

  it('hands every flag on in the snapshot, and recomputes it when a source changes', () => {
    conditions.activeUrl.set('https://example.org/article');

    expect(conditions.snapshot()).toEqual({
      onlyOfficePresent: false,
      onEduSharing: false,
      loggedIn: false,
      hasSession: false,
      hasActiveNode: false,
      hasDetectedNode: false,
      hasEditableMetadata: false,
      hasCuratedContent: false,
      recognizingContent: true,
      browserExtensionCustomWebComponent: false,
      qualityCriteriaMet: false,
      agentEditWindowClosed: false,
    });

    auth.signIn();
    curation.detect();
    curation.fake.hasEditableMetadata.set(true);
    curation.fake.hasCuratedResult.set(true);
    curation.fake.qualityCriteriaMet.set(true);
    curation.fake.agentEditWindowClosed.set(true);
    webComponent.fake.enabled.set(true);
    conditions.recognizingContent.set(false);

    expect(conditions.snapshot()).toEqual({
      onlyOfficePresent: false,
      onEduSharing: false,
      loggedIn: true,
      hasSession: true,
      hasActiveNode: true,
      hasDetectedNode: true,
      hasEditableMetadata: true,
      hasCuratedContent: true,
      recognizingContent: false,
      browserExtensionCustomWebComponent: true,
      qualityCriteriaMet: true,
      agentEditWindowClosed: true,
    });
  });
});
