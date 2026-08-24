import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Silences `console.log` for the duration of a test. The services log a line per step by design
 * (`[edu-sharing][history]`, `[edu-sharing][devmode]`, …), which is what makes the panel debuggable in
 * a browser and what makes a test report unreadable — a single history spec writes dozens of lines.
 *
 * `warn` and `error` are left alone: those report something going wrong, and a run should still say so.
 * Set `TEST_LOGS=1` to see the logs of the run you are debugging.
 */
if (!process.env['TEST_LOGS']) {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
  });
}
