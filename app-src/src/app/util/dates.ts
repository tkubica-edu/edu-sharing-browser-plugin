// Dates and durations as they arrive from a web page: a publication date in whichever of the three common
// spellings the page happens to use, and a learning time as an ISO-8601 duration.
//
// `toDate` in amb-event.ts stays where it is — it reads the panel's *own* payloads, where a date is already
// normalized, and its job is to refuse anything else. This module is the other direction: it reads what a
// stranger wrote.

/** How a date reaches a node property and the AMB record — the one spelling everything downstream expects. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The German spelling, which Dublin Core dates and visible datelines use. */
const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** A date given only as a year — a book's imprint, an archive page. */
const YEAR_ONLY = /^(\d{4})$/;

/** A slash-separated date, which is unambiguous only in the year-first order. */
const SLASHED_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

/**
 * The date as `YYYY-MM-DD`, from whatever a page states — an ISO timestamp, `06.05.2024`, `2024/05/06`, or a
 * bare year (which becomes its first day, the only reading that is a date at all). `null` for everything
 * else, including a plausible-looking `05/06/2024`: which of the two numbers is the month depends on where
 * the page was written, and a wrong date is worse than none.
 */
export function toIsoDate(value: unknown): string | null {
  const stated = typeof value === 'string' ? value.trim() : '';
  if (!stated) return null;
  const iso = ISO_DATE.exec(stated);
  if (iso) return isReal(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  const german = GERMAN_DATE.exec(stated);
  if (german) return padded(german[3], german[2], german[1]);
  const slashed = SLASHED_DATE.exec(stated);
  if (slashed) return padded(slashed[1], slashed[2], slashed[3]);
  const year = YEAR_ONLY.exec(stated);
  if (year) return `${year[1]}-01-01`;
  return null;
}

/**
 * An ISO-8601 duration (`PT45M`, `PT1H30M`, `P1DT2H`) in milliseconds. Only the parts that are a fixed
 * amount of time: a duration in months or years says nothing about how long something takes to work
 * through, and reading `P1M` as thirty days would invent a precision the notation does not have.
 *
 * `null` for anything that is not such a duration, and for one that comes out at zero.
 */
export function toDurationMs(value: unknown): number | null {
  const stated = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const parts = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
    .exec(stated);
  if (!parts || !parts.slice(1).some((part) => part !== undefined)) return null;
  const [weeks, days, hours, minutes, seconds] = parts.slice(1).map((part) => Number(part ?? 0));
  const total =
    weeks * 7 * 24 * 60 * 60 * 1000 +
    days * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000;
  return total > 0 ? Math.round(total) : null;
}

/** A date from its parts, zero-padded, or `null` where those parts are no date in any month. */
function padded(year: string, month: string, day: string): string | null {
  const paddedMonth = month.padStart(2, '0');
  const paddedDay = day.padStart(2, '0');
  return isReal(year, paddedMonth, paddedDay) ? `${year}-${paddedMonth}-${paddedDay}` : null;
}

/**
 * Whether the three parts name a day that exists. Checked against the calendar rather than by range, so
 * `2024-02-31` is refused as well — the parts of a mis-parsed string often are in range.
 */
function isReal(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}
