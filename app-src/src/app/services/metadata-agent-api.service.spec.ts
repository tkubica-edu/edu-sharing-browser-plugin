import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG, toAgentProxyUrl } from '../config';
import { MetadataAgentApiService } from './metadata-agent-api.service';

describe('MetadataAgentApiService', () => {
  let agentApi: MetadataAgentApiService;

  beforeEach(() => {
    agentApi = TestBed.inject(MetadataAgentApiService);
  });

  it('names the agent behind the repository the panel ships with', () => {
    expect(agentApi.baseUrl()).toBe(toAgentProxyUrl(APP_CONFIG.defaultRepositoryUrl));
  });

  it('never ends in a slash, since every endpoint is appended to it', () => {
    expect(agentApi.baseUrl().endsWith('/')).toBe(false);
  });

  it('is not the repository URL from the settings, so the agent stays reachable past a change there', () => {
    // Deliberately fixed: a repository without a B-API would otherwise take the agent with it.
    expect(agentApi.baseUrl()).toBe(TestBed.inject(MetadataAgentApiService).baseUrl());
  });
});
