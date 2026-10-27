import { describe, expect, it } from 'vitest';
import {
  ACCESS_LIFETIME_MS,
  MAX_ACCESS_MINUTES,
  canTransition,
  createAccessSchema,
  durationSchema,
  formatDuration,
  effectiveStatus,
  expiryFor,
  formatRemaining,
  generatePassword,
  isExpired,
  normalizeUsername,
  passwordSchema,
  rotateCredentialsSchema,
  slugSchema,
  usernameSchema,
} from '@/lib/domain';

describe('username normalization', () => {
  it('trims and lowercases', () => {
    expect(normalizeUsername('  Batch.Group_12 ')).toBe('batch.group_12');
    expect(usernameSchema.parse(' STUDENT ')).toBe('student');
  });
  it('rejects invalid usernames', () => {
    for (const bad of ['ab', 'has space', 'semi;colon', 'x'.repeat(41), '']) {
      expect(usernameSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('password rules', () => {
  it('does not alter the password', () => {
    expect(passwordSchema.parse('  Mixed Case  ')).toBe('  Mixed Case  ');
  });
  it('enforces length bounds', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(8)).success).toBe(true);
  });
  it('generates strong unique passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(14);
      expect(passwordSchema.safeParse(p).success).toBe(true);
      expect(p).toMatch(/[-_!@#]/);
      expect(p).toMatch(/[2-9]/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('access state machine', () => {
  it('allows only documented transitions', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('draft', 'closed')).toBe(true);
    expect(canTransition('active', 'closed')).toBe(true);
    expect(canTransition('active', 'expired')).toBe(true);
    expect(canTransition('closed', 'active')).toBe(false);
    expect(canTransition('expired', 'active')).toBe(false);
    expect(canTransition('active', 'draft')).toBe(false);
    expect(canTransition('draft', 'expired')).toBe(false);
  });
});

describe('expiry', () => {
  const start = new Date('2026-10-26T09:00:00.000Z');
  const expires = expiryFor(start);

  it('is exactly 24 hours after start', () => {
    expect(expires.getTime() - start.getTime()).toBe(ACCESS_LIFETIME_MS);
    expect(expires.toISOString()).toBe('2026-10-27T09:00:00.000Z');
  });
  it('honours shorter durations and never exceeds 24 hours', () => {
    expect(expiryFor(start, 60).toISOString()).toBe('2026-10-26T10:00:00.000Z');
    expect(expiryFor(start, 5000).getTime() - start.getTime()).toBe(ACCESS_LIFETIME_MS);
    expect(durationSchema.safeParse(MAX_ACCESS_MINUTES).success).toBe(true);
    expect(durationSchema.safeParse(MAX_ACCESS_MINUTES + 1).success).toBe(false);
    expect(durationSchema.safeParse(14).success).toBe(false);
    expect(formatDuration(1440)).toBe('24 hours');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });
  it('is expired at the boundary and after, not before', () => {
    expect(isExpired(expires, new Date(expires.getTime() - 1))).toBe(false);
    expect(isExpired(expires, new Date(expires.getTime()))).toBe(true);
    expect(isExpired(expires, new Date(expires.getTime() + 1))).toBe(true);
  });
  it('derives the effective status', () => {
    const iso = expires.toISOString();
    expect(effectiveStatus('active', iso, new Date(expires.getTime() - 1))).toBe('active');
    expect(effectiveStatus('active', iso, expires)).toBe('expired');
    expect(effectiveStatus('closed', iso, expires)).toBe('closed');
    expect(effectiveStatus('draft', null, expires)).toBe('draft');
  });
  it('formats remaining time', () => {
    expect(formatRemaining(0)).toBe('Expired');
    expect(formatRemaining(-5)).toBe('Expired');
    expect(formatRemaining(65_000)).toBe('1m 05s');
    expect(formatRemaining(3 * 3600_000 + 7 * 60_000)).toBe('3h 07m');
  });
});

describe('request validation', () => {
  const valid = {
    requestId: '7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d',
    name: 'Batch 1',
    application: 'sap-erp',
    username: 'Student',
    password: 'Secret-Pass-1',
  };
  it('accepts valid access, normalizes the username and defaults to 24 hours', () => {
    const parsed = createAccessSchema.parse(valid);
    expect(parsed.username).toBe('student');
    expect(parsed.password).toBe('Secret-Pass-1');
    expect(parsed.durationMinutes).toBe(1440);
    expect(createAccessSchema.safeParse({ ...valid, durationMinutes: 1441 }).success).toBe(false);
  });
  it('rejects invalid application slugs and ids', () => {
    expect(createAccessSchema.safeParse({ ...valid, application: '../etc/passwd' }).success).toBe(false);
    expect(createAccessSchema.safeParse({ ...valid, requestId: 'nope' }).success).toBe(false);
    expect(slugSchema.safeParse('SAP ERP').success).toBe(false);
  });
  it('requires at least one credential change when rotating', () => {
    expect(rotateCredentialsSchema.safeParse({}).success).toBe(false);
    expect(rotateCredentialsSchema.safeParse({ password: 'New-Secret-1' }).success).toBe(true);
    expect(rotateCredentialsSchema.safeParse({ username: 'x' }).success).toBe(false);
  });
});
