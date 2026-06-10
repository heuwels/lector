import { describe, it, expect } from 'vitest';
import { dateStringInTimeZone, addDaysToDateString, isValidTimeZone } from '../dates';

describe('dateStringInTimeZone', () => {
  it('formats a UTC instant as the local calendar date (UTC+10, before local midnight)', () => {
    // 13:59 UTC = 23:59 in Brisbane (UTC+10, no DST)
    expect(dateStringInTimeZone(new Date('2026-06-10T13:59:00Z'), 'Australia/Brisbane')).toBe(
      '2026-06-10'
    );
  });

  it('rolls over at local midnight, not UTC midnight', () => {
    // 14:00 UTC = 00:00 next day in Brisbane
    expect(dateStringInTimeZone(new Date('2026-06-10T14:00:00Z'), 'Australia/Brisbane')).toBe(
      '2026-06-11'
    );
  });

  it('credits early-morning study to the correct local day (the issue #108 case)', () => {
    // 09:00 Tuesday in Brisbane is 23:00 Monday UTC — UTC math credited this
    // to Monday and broke streaks.
    const tueMorning = new Date('2026-06-09T23:00:00Z');
    expect(dateStringInTimeZone(tueMorning, 'Australia/Brisbane')).toBe('2026-06-10');
    expect(dateStringInTimeZone(tueMorning, 'UTC')).toBe('2026-06-09');
  });

  it('matches toISOString for UTC', () => {
    const d = new Date('2026-01-05T07:30:00Z');
    expect(dateStringInTimeZone(d, 'UTC')).toBe('2026-01-05');
  });
});

describe('addDaysToDateString', () => {
  it('subtracts across month boundaries', () => {
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap years', () => {
    expect(addDaysToDateString('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('adds across year boundaries', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('is identity for zero days', () => {
    expect(addDaysToDateString('2026-06-10', 0)).toBe('2026-06-10');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones', () => {
    expect(isValidTimeZone('Australia/Brisbane')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects junk and empty values', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
