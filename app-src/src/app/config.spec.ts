import { describe, expect, it } from 'vitest';

import { APP_CONFIG, METADATA_AGENT_API_URL, toAgentProxyUrl, toApiRootUrl, toTopicAssistantUrl } from './config';

const REPO = 'https://repo.example.org/edu-sharing';

describe('toApiRootUrl', () => {
  it('appends the REST root to a repository address', () => {
    expect(toApiRootUrl(REPO)).toBe(`${REPO}/rest`);
  });

  it('leaves an address that already names the REST root alone', () => {
    expect(toApiRootUrl(`${REPO}/rest`)).toBe(`${REPO}/rest`);
  });

  it('takes an address however many slashes it ends in', () => {
    expect(toApiRootUrl(`${REPO}/`)).toBe(`${REPO}/rest`);
    expect(toApiRootUrl(`${REPO}///`)).toBe(`${REPO}/rest`);
    expect(toApiRootUrl(`${REPO}/rest/`)).toBe(`${REPO}/rest`);
  });

  it('takes one the user typed with blanks around it', () => {
    expect(toApiRootUrl(`  ${REPO}  `)).toBe(`${REPO}/rest`);
  });

  it('does not mistake a path merely ending in those letters for the REST root', () => {
    expect(toApiRootUrl(`${REPO}/forest`)).toBe(`${REPO}/forest/rest`);
  });

  it('answers for an address that is none, rather than throwing on the boot path', () => {
    expect(toApiRootUrl('')).toBe('/rest');
  });
});

describe('toAgentProxyUrl', () => {
  it('names the agent behind the repository\'s own proxy', () => {
    expect(toAgentProxyUrl(REPO)).toBe(`${REPO}/rest/bapi/api/v1/proxy/metadata-agent-canvas`);
  });

  it('derives the same address from a repository already named by its REST root', () => {
    expect(toAgentProxyUrl(`${REPO}/rest`)).toBe(toAgentProxyUrl(REPO));
    expect(toAgentProxyUrl(`${REPO}/`)).toBe(toAgentProxyUrl(REPO));
  });
});

describe('toTopicAssistantUrl', () => {
  it('names the topic assistant behind the same proxy', () => {
    expect(toTopicAssistantUrl(REPO)).toBe(
      `${REPO}/rest/bapi/api/v1/proxy/kidra/topic-assistant-keywords`,
    );
  });

  it('sits under the same B-API proxy as the agent, since both authorize by repository session', () => {
    const proxy = `${REPO}/rest/bapi/api/v1/proxy/`;
    expect(toAgentProxyUrl(REPO).startsWith(proxy)).toBe(true);
    expect(toTopicAssistantUrl(REPO).startsWith(proxy)).toBe(true);
  });
});

describe('METADATA_AGENT_API_URL', () => {
  it('is where the configured repository proxies the agent, not a deployment of its own', () => {
    expect(METADATA_AGENT_API_URL).toBe(toAgentProxyUrl(APP_CONFIG.defaultRepositoryUrl));
  });
});
