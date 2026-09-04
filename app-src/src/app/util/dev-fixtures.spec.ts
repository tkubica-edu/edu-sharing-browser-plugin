import { describe, expect, it } from 'vitest';

import { CONTENT_JUDGE_HEALTH, EXTRACT_FIELD_ANSWER, contentJudgeEvaluateRejection } from './dev-fixtures';

describe('EXTRACT_FIELD_ANSWER', () => {
  it('answers the field the endpoint is asked for, as the agent shapes such an answer', () => {
    expect(EXTRACT_FIELD_ANSWER.field_id).toBe('cclom:general_keyword');
    expect(EXTRACT_FIELD_ANSWER.value.length).toBeGreaterThan(0);
    expect(EXTRACT_FIELD_ANSWER.changed).toBe(true);
  });

  it('is one object, so a second call cannot be told from the first by what it answers', () => {
    expect(EXTRACT_FIELD_ANSWER.value).toEqual(EXTRACT_FIELD_ANSWER.value);
  });
});

describe('CONTENT_JUDGE_HEALTH', () => {
  it('describes a deployment that is ready and has its schemes loaded', () => {
    expect(CONTENT_JUDGE_HEALTH.status).toBe('healthy');
    expect(CONTENT_JUDGE_HEALTH.schemes_loaded).toBeGreaterThan(0);
  });
});

describe('contentJudgeEvaluateRejection', () => {
  it('is worded exactly as fetchJson words a 422, so the view reports it like the real one', () => {
    // The wording is `${service} antwortet mit ${status}: ${detail}` in `util/json-api.ts`.
    expect(contentJudgeEvaluateRejection().message).toMatch(/^ContentJudge antwortet mit 422: /);
  });

  it('carries FastAPI\'s validation error as the body of that answer', () => {
    const body = contentJudgeEvaluateRejection().message.replace('ContentJudge antwortet mit 422: ', '');
    expect(JSON.parse(body).detail[0]).toMatchObject({ type: 'value_error', loc: ['body', 'text'] });
  });

  it('says in the message itself that no judgement was asked for', () => {
    expect(contentJudgeEvaluateRejection().message).toContain('dev mode');
  });

  it('is a fresh Error each time, so a caught one carries no other call\'s stack', () => {
    expect(contentJudgeEvaluateRejection()).not.toBe(contentJudgeEvaluateRejection());
    expect(contentJudgeEvaluateRejection().message).toBe(contentJudgeEvaluateRejection().message);
  });
});
