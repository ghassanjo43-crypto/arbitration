/**
 * Pure procedural deadline calculation engine.
 *
 * Implements the platform deadline rules (adapted from UNCITRAL Art. 2 timing):
 *  - The triggering day is EXCLUDED; the period begins on the following day.
 *  - Supports CALENDAR and BUSINESS day counting.
 *  - Weekends and holidays come from a HolidayCalendar.
 *  - If the last day of a calendar-day period is a weekend/holiday, the deadline
 *    rolls forward to the next business day.
 *  - All civil-date arithmetic is performed in the official case time zone, and
 *    the resulting due moment is the configured cut-off time (default 23:59:59)
 *    of that day, returned as a UTC instant.
 *
 * No third-party date library is used; timezone conversion relies on the
 * platform Intl time-zone database (available in Node 20+).
 */

export type DayKind = 'CALENDAR' | 'BUSINESS';

export interface HolidayCalendarSpec {
  /** IANA time zone, e.g. "Europe/Paris". */
  timezone: string;
  /** Weekend day numbers, 0=Sunday .. 6=Saturday. Default Sat+Sun. */
  weekend: number[];
  /** Holiday civil dates as 'YYYY-MM-DD' strings in the calendar's time zone. */
  holidays: string[];
}

export interface DeadlineInput {
  /** The UTC instant of the triggering procedural event. */
  triggerDate: Date;
  /** Number of days in the period (must be >= 1). */
  days: number;
  dayKind: DayKind;
  calendar: HolidayCalendarSpec;
  /** Cut-off time of day in the case time zone. Defaults to 23:59:59. */
  cutoff?: { hour: number; minute: number; second: number };
}

export interface DeadlineResult {
  /** Civil date of the trigger in the case time zone ('YYYY-MM-DD'). */
  triggerCivilDate: string;
  /** Civil date the clock starts (day after the trigger). */
  startCivilDate: string;
  /** Civil date the deadline falls on, after any roll-forward. */
  dueCivilDate: string;
  /** UTC instant of the deadline cut-off. */
  dueAt: Date;
  /** True if the computed last day was rolled forward off a non-business day. */
  rolledForward: boolean;
}

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const DEFAULT_CUTOFF = { hour: 23, minute: 59, second: 59 };
const DEFAULT_WEEKEND = [0, 6]; // Sunday, Saturday

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function civilToKey(d: CivilDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** Civil date/time (in `tz`) → UTC instant, accounting for the zone offset. */
export function zonedCivilToUtc(
  d: CivilDate,
  time: { hour: number; minute: number; second: number },
  tz: string,
): Date {
  // First guess: interpret the civil wall-clock time as if it were UTC.
  const utcGuess = Date.UTC(d.year, d.month - 1, d.day, time.hour, time.minute, time.second);
  // Measure the zone's offset at that instant and correct for it.
  const offset = zoneOffsetMs(tz, new Date(utcGuess));
  return new Date(utcGuess - offset);
}

/** Offset in ms such that: wallClock(tz) = utcInstant + offset. */
function zoneOffsetMs(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - instant.getTime();
}

/** UTC instant → civil date in `tz`. */
export function utcToZonedCivil(instant: Date, tz: string): CivilDate {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return { year: map.year, month: map.month, day: map.day };
}

/** Add `n` calendar days to a civil date (n may be negative). */
export function addCivilDays(d: CivilDate, n: number): CivilDate {
  // Use a UTC anchor purely for date arithmetic; no tz semantics here.
  const anchor = new Date(Date.UTC(d.year, d.month - 1, d.day));
  anchor.setUTCDate(anchor.getUTCDate() + n);
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1, day: anchor.getUTCDate() };
}

/** ISO weekday for a civil date: 0=Sunday .. 6=Saturday. */
function weekdayOf(d: CivilDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function isBusinessDay(d: CivilDate, calendar: HolidayCalendarSpec): boolean {
  const weekend = calendar.weekend?.length ? calendar.weekend : DEFAULT_WEEKEND;
  if (weekend.includes(weekdayOf(d))) return false;
  if (calendar.holidays?.includes(civilToKey(d))) return false;
  return true;
}

/** Roll a civil date forward to the next business day (no-op if already one). */
function rollToNextBusinessDay(d: CivilDate, calendar: HolidayCalendarSpec): { date: CivilDate; moved: boolean } {
  let cursor = d;
  let moved = false;
  while (!isBusinessDay(cursor, calendar)) {
    cursor = addCivilDays(cursor, 1);
    moved = true;
  }
  return { date: cursor, moved };
}

/**
 * Compute a procedural deadline. Throws on invalid input.
 */
export function computeDeadline(input: DeadlineInput): DeadlineResult {
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new Error('Deadline period must be a positive whole number of days.');
  }
  const tz = input.calendar.timezone || 'UTC';
  const cutoff = input.cutoff ?? DEFAULT_CUTOFF;

  const triggerCivil = utcToZonedCivil(input.triggerDate, tz);
  // The triggering day is excluded: the clock starts the following day.
  const startCivil = addCivilDays(triggerCivil, 1);

  let dueCivil: CivilDate;
  let rolledForward = false;

  if (input.dayKind === 'BUSINESS') {
    // Count business days starting the day AFTER the trigger.
    let cursor = triggerCivil;
    let counted = 0;
    while (counted < input.days) {
      cursor = addCivilDays(cursor, 1);
      if (isBusinessDay(cursor, input.calendar)) counted++;
    }
    dueCivil = cursor; // last day is a business day by construction
  } else {
    // Calendar days: last day = trigger + N, then roll forward off non-business days.
    const raw = addCivilDays(triggerCivil, input.days);
    const rolled = rollToNextBusinessDay(raw, input.calendar);
    dueCivil = rolled.date;
    rolledForward = rolled.moved;
  }

  const dueAt = zonedCivilToUtc(dueCivil, cutoff, tz);

  return {
    triggerCivilDate: civilToKey(triggerCivil),
    startCivilDate: civilToKey(startCivil),
    dueCivilDate: civilToKey(dueCivil),
    dueAt,
    rolledForward,
  };
}
