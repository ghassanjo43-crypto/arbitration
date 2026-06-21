import {
  computeDeadline,
  isBusinessDay,
  addCivilDays,
  utcToZonedCivil,
  zonedCivilToUtc,
  computeReminderSchedule,
  durationTokenToDays,
  isOverdue,
  HolidayCalendarSpec,
} from './deadline-engine';

const UTC_CAL: HolidayCalendarSpec = { timezone: 'UTC', weekend: [0, 6], holidays: [] };

describe('deadline-engine', () => {
  describe('civil-date helpers', () => {
    it('rolls month boundaries when adding days', () => {
      expect(addCivilDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 1 });
      expect(addCivilDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    });

    it('round-trips a UTC instant to civil date in a zone', () => {
      // 2026-06-20T23:30:00Z is already 2026-06-21 in Tokyo (UTC+9).
      const civil = utcToZonedCivil(new Date('2026-06-20T23:30:00Z'), 'Asia/Tokyo');
      expect(civil).toEqual({ year: 2026, month: 6, day: 21 });
    });

    it('converts a zoned civil cut-off back to the correct UTC instant', () => {
      // End of day in Paris (UTC+2 in June) is 21:59:59Z.
      const due = zonedCivilToUtc(
        { year: 2026, month: 6, day: 30 },
        { hour: 23, minute: 59, second: 59 },
        'Europe/Paris',
      );
      expect(due.toISOString()).toBe('2026-06-30T21:59:59.000Z');
    });
  });

  describe('business-day detection', () => {
    it('treats weekends as non-business days', () => {
      // 2026-06-20 is a Saturday, 2026-06-21 a Sunday, 2026-06-22 a Monday.
      expect(isBusinessDay({ year: 2026, month: 6, day: 20 }, UTC_CAL)).toBe(false);
      expect(isBusinessDay({ year: 2026, month: 6, day: 21 }, UTC_CAL)).toBe(false);
      expect(isBusinessDay({ year: 2026, month: 6, day: 22 }, UTC_CAL)).toBe(true);
    });

    it('treats listed holidays as non-business days', () => {
      const cal: HolidayCalendarSpec = { timezone: 'UTC', weekend: [0, 6], holidays: ['2026-06-22'] };
      expect(isBusinessDay({ year: 2026, month: 6, day: 22 }, cal)).toBe(false);
    });
  });

  describe('computeDeadline — trigger day exclusion', () => {
    it('starts the clock on the day AFTER the trigger', () => {
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T10:00:00Z'),
        days: 30,
        dayKind: 'CALENDAR',
        calendar: UTC_CAL,
      });
      expect(r.triggerCivilDate).toBe('2026-06-01');
      expect(r.startCivilDate).toBe('2026-06-02');
    });
  });

  describe('computeDeadline — calendar days', () => {
    it('adds N calendar days to the trigger date (30-day response)', () => {
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T09:00:00Z'),
        days: 30,
        dayKind: 'CALENDAR',
        calendar: UTC_CAL,
      });
      // 2026-07-01 is a Wednesday → no roll.
      expect(r.dueCivilDate).toBe('2026-07-01');
      expect(r.rolledForward).toBe(false);
      expect(r.dueAt.toISOString()).toBe('2026-07-01T23:59:59.000Z');
    });

    it('rolls forward when the last calendar day is a weekend', () => {
      // Trigger Mon 2026-06-15; +5 calendar days = Sat 2026-06-20 → roll to Mon 2026-06-22.
      const r = computeDeadline({
        triggerDate: new Date('2026-06-15T09:00:00Z'),
        days: 5,
        dayKind: 'CALENDAR',
        calendar: UTC_CAL,
      });
      expect(r.dueCivilDate).toBe('2026-06-22');
      expect(r.rolledForward).toBe(true);
    });

    it('rolls forward when the last calendar day is a holiday', () => {
      const cal: HolidayCalendarSpec = {
        timezone: 'UTC',
        weekend: [0, 6],
        holidays: ['2026-07-01', '2026-07-02'],
      };
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T09:00:00Z'),
        days: 30,
        dayKind: 'CALENDAR',
        calendar: cal,
      });
      // 2026-07-01 (Wed) and 07-02 (Thu) are holidays → 07-03 (Fri) is the deadline.
      expect(r.dueCivilDate).toBe('2026-07-03');
      expect(r.rolledForward).toBe(true);
    });
  });

  describe('computeDeadline — business days', () => {
    it('counts only business days, last day always a business day', () => {
      // Trigger Mon 2026-06-01. 5 business days → Mon 08 is day 5 (02,03,04,05,08).
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T09:00:00Z'),
        days: 5,
        dayKind: 'BUSINESS',
        calendar: UTC_CAL,
      });
      expect(r.dueCivilDate).toBe('2026-06-08');
      expect(isBusinessDay({ year: 2026, month: 6, day: 8 }, UTC_CAL)).toBe(true);
    });

    it('skips holidays while counting business days', () => {
      const cal: HolidayCalendarSpec = { timezone: 'UTC', weekend: [0, 6], holidays: ['2026-06-03'] };
      // Trigger Mon 06-01; business days: 02, (skip 03 holiday), 04, 05, 08, 09 → 5th is 09.
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T09:00:00Z'),
        days: 5,
        dayKind: 'BUSINESS',
        calendar: cal,
      });
      expect(r.dueCivilDate).toBe('2026-06-09');
    });
  });

  describe('computeDeadline — time-zone cut-off', () => {
    it('uses the case time zone for the trigger civil date (late-night UTC service)', () => {
      // 23:30Z on 06-20 is already 06-21 in Tokyo → clock starts 06-22.
      const r = computeDeadline({
        triggerDate: new Date('2026-06-20T23:30:00Z'),
        days: 10,
        dayKind: 'CALENDAR',
        calendar: { timezone: 'Asia/Tokyo', weekend: [0, 6], holidays: [] },
      });
      expect(r.triggerCivilDate).toBe('2026-06-21');
      expect(r.startCivilDate).toBe('2026-06-22');
    });

    it('returns the cut-off as the correct UTC instant for the zone', () => {
      const r = computeDeadline({
        triggerDate: new Date('2026-06-01T09:00:00Z'),
        days: 10,
        dayKind: 'CALENDAR',
        calendar: { timezone: 'Asia/Dubai', weekend: [0, 6], holidays: [] },
        cutoff: { hour: 17, minute: 0, second: 0 },
      });
      // Dubai is UTC+4 year-round; 17:00 local on 06-11 = 13:00Z.
      expect(r.dueAt.toISOString()).toBe('2026-06-11T13:00:00.000Z');
    });
  });

  describe('computeDeadline — validation', () => {
    it('rejects non-positive periods', () => {
      expect(() =>
        computeDeadline({ triggerDate: new Date(), days: 0, dayKind: 'CALENDAR', calendar: UTC_CAL }),
      ).toThrow();
    });
  });

  describe('reminders & overdue', () => {
    it('parses day/week duration tokens', () => {
      expect(durationTokenToDays('P7D')).toBe(7);
      expect(durationTokenToDays('P2W')).toBe(14);
      expect(durationTokenToDays('P1W')).toBe(7);
      expect(durationTokenToDays('nonsense')).toBeNull();
    });

    it('schedules reminders the right number of days before due, sorted', () => {
      const due = new Date('2026-07-01T23:59:59.000Z');
      const slots = computeReminderSchedule(due, 'P7D,P2D,P1D');
      expect(slots.map((s) => s.offsetToken)).toEqual(['P7D', 'P2D', 'P1D']);
      expect(slots[0].scheduledFor.toISOString().slice(0, 10)).toBe('2026-06-24');
      expect(slots[2].scheduledFor.toISOString().slice(0, 10)).toBe('2026-06-30');
    });

    it('drops reminder slots already in the past relative to `from`', () => {
      const due = new Date('2026-07-01T23:59:59.000Z');
      const from = new Date('2026-06-30T00:00:00.000Z'); // after the P7D (06-24) and P2D (06-29) slots
      const slots = computeReminderSchedule(due, 'P7D,P2D,P1D', from);
      expect(slots.map((s) => s.offsetToken)).toEqual(['P1D']);
    });

    it('returns no slots for an empty rule', () => {
      expect(computeReminderSchedule(new Date(), null)).toEqual([]);
    });

    it('flags overdue strictly after the due moment', () => {
      const due = new Date('2026-07-01T23:59:59.000Z');
      expect(isOverdue(due, new Date('2026-07-02T00:00:00.000Z'))).toBe(true);
      expect(isOverdue(due, new Date('2026-07-01T00:00:00.000Z'))).toBe(false);
    });
  });
});
