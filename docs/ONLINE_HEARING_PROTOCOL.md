# Online Hearing Protocol (Chapter 15)

> **Counsel-review notice.** Hearing conduct, recording consent, and witness
> protocols must be confirmed against the law of the seat and the tribunal's
> directions before production use.

## Scope

Supports fully online, hybrid and in-person hearings. The platform schedules and
records the hearing; the **tribunal controls its conduct**.

## Provider abstraction

The platform does **not** build a video engine. It defines provider interfaces
(`apps/api/src/providers/video/`) for **Zoom, Microsoft Teams, Google Meet** and
other secure providers, with a development/placeholder adapter. Select via the
`VIDEO_DRIVER` environment variable.

## Entities

`Hearing` → `HearingRoom` (tribunal room, party rooms, breakout rooms, witness
waiting room, interpreter channels) and `HearingParticipant` (attendance log).

## Protocol elements (to be enforced by tribunal direction)

- Hearing request, party comments, tribunal decision; schedule with time zones.
- Technical test session and participant verification before the hearing.
- Electronic hearing bundle, screen sharing, document presentation.
- Recording permissions; transcript; attendance log.
- Witness isolation (see Chapter 13 / `Witness.isolationAcknowledged`),
  prohibited private assistance, prohibited unauthorised recording.
- Technical-interruption handling: backup communication channel, backup hearing
  link, reconnection procedure, cybersecurity-incident handling, adjournment.

## Status

Schema and provider interfaces are in place; deeper room/interpreter-channel and
bundle tooling is a follow-up phase. The tribunal's procedural order governs any
gap.

## Source

`apps/api/src/hearings/`, `apps/api/src/providers/video/`.
