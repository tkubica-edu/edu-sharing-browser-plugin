/**
 * Pins the run to UTC.
 *
 * The panel formats dates in the reader's own zone — `DatePipe` with no zone argument, which is right
 * for the product and wrong for a test: an assertion on a rendered date then passes in Berlin and fails
 * on a CI runner in UTC, which is exactly what happened. Pinning it here is the one place that decides
 * it, so a spec may state the rendering of a fixture instant outright.
 *
 * UTC rather than the zone the panel is used in, because it has no daylight saving: under `Europe/Berlin`
 * the rendering of a fixture would depend on the time of year it falls in.
 *
 * Set on `process.env` rather than passed to Node, so it holds however the suite is started. Node re-reads
 * the variable, and `Intl` follows it even where a date was formatted before this ran — checked on the
 * Node this repo builds with.
 */
process.env['TZ'] = 'UTC';
