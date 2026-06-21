# Deadline Calculation

> **Counsel-review notice.** Default periods are configurable placeholders and
> must be reviewed by qualified arbitration counsel and reconciled with the law
> of the seat before production launch.

The deadline engine (`apps/api/src/deadlines/deadline-engine.ts`, pure and
unit-tested) computes procedural deadlines deterministically.

## Calculation rules

- The **triggering day is excluded**; the clock starts the following day.
- Supports **calendar days** and **business days** (`DayKind`).
- Weekends and holidays come from a `HolidayCalendar` (`weekend` day numbers +
  `Holiday` dates).
- For a calendar-day period, if the last day is a weekend/holiday it **rolls
  forward** to the next business day. Business-day periods land on a business day
  by construction.
- All civil-date arithmetic runs in the **official case time zone**; the result
  is the cut-off instant (default 23:59:59) of that day, returned as UTC.
- Deadlines are displayed in both the official time zone and the user's local
  time on the frontend.

## Lifecycle

A `Deadline` is generated from a `RuleDeadlineDefinition` and a
`CaseProceduralEvent` (manually via `generateFromDefinition`, or automatically by
the rules engine). Provenance is stored: rule, definition key, trigger event,
trigger date, start date, period, day-kind, holiday calendar, responsible role.

- **A filing is not complete** until the required files upload successfully and
  the portal issues confirmation; corrupted/failed uploads do not count.
- **Extensions never silently overwrite** a deadline: a `DeadlineExtension`
  (kind `EXTENSION`) row records the previous due date, the new date, the reason
  and the ordering authority **before** `dueAt` moves.
- **Suspension / resumption.** Suspend pauses the clock (`SUSPENDED`,
  `suspendedAt` set; `dueAt` not moved). Resume adds the *preserved remaining
  time* (`dueAt − suspendedAt`) to the resumption moment, recording a
  `RESUMPTION` row. Remaining time is never lost.
- **Waiver.** `WAIVED` excuses the requirement and clears unsent reminders.
- **Reminders.** `DeadlineReminder` rows are materialised from a `reminderRule`
  (e.g. `P7D,P2D,P1D` → 7/2/1 days before due) on create, generate, extend and
  resume. Past slots are dropped.
- **Overdue & escalation.** `escalateOverdue` flags past-due `OPEN`/`EXTENDED`
  deadlines as `OVERDUE` and raises a one-off registrar escalation reminder
  (idempotent).
- Only authorised persons (registry / tribunal) may extend, suspend, shorten,
  waive or resume a deadline. Everything is audited.

## Suggested configurable defaults

These are starting points only — **subject to tribunal authority and the law of
the seat**:

| Step | Default |
|------|---------|
| Response to Notice of Arbitration | 30 days |
| Response to proposed sole arbitrator | 15 days |
| Conflict disclosure | 7 days |
| Objection following conflict disclosure | 15 days |
| Arbitrator acceptance | 7 days |
| Payment of initial deposit | 15 days |
| Correction of defective filing | 7–14 days |
| Statement of Claim / Defence | 30 days |
| Counterclaim response | 21–30 days |
| Reply / Rejoinder | 21 days |
| Procedural-application response | 7–14 days |
| Award correction / interpretation request | per applicable law and rules |

## Source

`apps/api/src/deadlines/`. Tests: `deadline-engine.spec.ts`,
`deadlines.service.spec.ts` (trigger-day exclusion, calendar/business days,
weekend/holiday roll-forward, time-zone cut-off, reminders, suspend/resume
remaining-time preservation, waiver, overdue).
