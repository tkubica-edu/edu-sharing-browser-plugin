// Faked answers of the calls the sidebar makes itself, for the dev mode (see DevModeService). The
// agent's `/health` and `/generate` are not here: those go out from the background worker, which has
// fixtures of its own (background/dev-fixtures.js).

// Type-only, and deliberately so: the service imports these fixtures, so a value import here would
// be a cycle between the two modules.
import type { ContentJudgeHealth } from '../services/content-judge.service';

/**
 * The metadata agent's `POST /extract-field` — a real answer, captured rather than invented: the Schlagwörter of
 * one content, since that is the field the endpoint is asked for. Sent whatever field is asked for, so a second
 * caller would get keywords under its own field's name; the requested id is logged, which makes that visible.
 */
export const EXTRACT_FIELD_ANSWER = {
  field_id: 'cclom:general_keyword',
  field_label: 'Schlagwörter',
  value: [
    'Photosynthese',
    'Biologie',
    'Chlorophyll',
    'Chloroplasten',
    'Calvin-Zyklus',
    'Lichtreaktion',
    'Sekundarstufe I',
  ],
  raw_value: null,
  previous_value: null,
  changed: true,
  normalized: false,
  context: 'default',
  version: '2.0.0',
  schema_file: 'core.json',
  processing: {
    llm_provider: 'b-api-openai',
    llm_model: 'gpt-4.1-mini',
    processing_time_ms: 2302,
  },
};

/** ContentJudge's `GET /health/` — a ready deployment with its schemes loaded. */
export const CONTENT_JUDGE_HEALTH: ContentJudgeHealth = {
  status: 'healthy',
  version: '0.1.0',
  schemes_loaded: 198,
};

/**
 * The body of the `422` that stands in for a judgement — FastAPI's validation error, as the endpoint answers one.
 * A failure rather than a verdict, so the flow is exercised on the branch where ContentJudge answers nothing;
 * whoever needs a real verdict switches the mode off.
 */
const CONTENT_JUDGE_EVALUATE_DETAIL = {
  detail: [
    {
      type: 'value_error',
      loc: ['body', 'text'],
      msg: 'Value error, dev mode: no judgement is requested while answers are faked',
      input: null,
    },
  ],
};

/**
 * The rejection a faked `POST /evaluate/` produces — worded exactly as `fetchJson` words a `422`, so
 * the view reports it the way it reports the real one.
 */
export function contentJudgeEvaluateRejection(): Error {
  return new Error(
    `ContentJudge antwortet mit 422: ${JSON.stringify(CONTENT_JUDGE_EVALUATE_DETAIL)}`,
  );
}
