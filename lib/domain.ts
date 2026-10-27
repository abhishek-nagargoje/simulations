// Pure domain rules shared by the UI and the server. The database enforces the
// same rules (see supabase/migrations); these mirror them for early, friendly
// validation and are what the unit tests exercise.
import { z } from 'zod';

/** Maximum lifetime of an access session. */
export const MAX_ACCESS_MINUTES = 24 * 60;
export const MIN_ACCESS_MINUTES = 15;
export const ACCESS_LIFETIME_MS = MAX_ACCESS_MINUTES * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 12_000;

/** Lifetimes a teacher can choose (minutes). 24 hours is the default and maximum. */
export const DURATION_OPTIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: '24 hours' },
] as const;

export type AccessStatus = 'draft' | 'active' | 'closed' | 'expired';

/** Allowed transitions. Anything not listed is rejected by the database. */
export const TRANSITIONS: Record<AccessStatus, readonly AccessStatus[]> = {
  draft: ['active', 'closed'],
  active: ['closed', 'expired'],
  closed: [],
  expired: [],
};

export function canTransition(from: AccessStatus, to: AccessStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .refine((v) => USERNAME_RE.test(v), {
    message: 'Use 3–40 characters: letters, numbers, dot, dash or underscore.',
  });

// Passwords are never trimmed or case-folded. 72 is bcrypt's input limit.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

export const accessNameSchema = z
  .string()
  .trim()
  .min(3, 'Name must be at least 3 characters.')
  .max(120, 'Name must be at most 120 characters.');

export const durationSchema = z
  .number()
  .int()
  .min(MIN_ACCESS_MINUTES, 'Duration must be at least 15 minutes.')
  .max(MAX_ACCESS_MINUTES, 'Duration cannot exceed 24 hours.');

export const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64);

export const createAccessSchema = z.object({
  requestId: z.uuid(),
  name: accessNameSchema,
  application: slugSchema,
  username: usernameSchema,
  password: passwordSchema,
  durationMinutes: durationSchema.default(MAX_ACCESS_MINUTES),
});

export const rotateCredentialsSchema = z
  .object({
    username: usernameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => v.username !== undefined || v.password !== undefined, {
    message: 'Provide a new username, a new password, or both.',
  });

export const studentLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const teacherLoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const uuidSchema = z.uuid();

/** Access authorizes nothing at or after its expiry instant. */
export function isExpired(expiresAt: Date | string, now: Date): boolean {
  return now.getTime() >= new Date(expiresAt).getTime();
}

export function expiryFor(startedAt: Date, minutes: number = MAX_ACCESS_MINUTES): Date {
  return new Date(startedAt.getTime() + Math.min(minutes, MAX_ACCESS_MINUTES) * 60_000);
}

export function effectiveStatus(status: AccessStatus, expiresAt: string | null, now: Date): AccessStatus {
  if (status === 'active' && expiresAt && isExpired(expiresAt, now)) return 'expired';
  return status;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Expired';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatDuration(minutes: number): string {
  const opt = DURATION_OPTIONS.find((o) => o.minutes === minutes);
  if (opt) return opt.label;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_SYMBOLS = '-_!@#';

/** Unbiased random password (~80 bits) that is easy to read aloud. */
export function generatePassword(length = 14): string {
  const chars: string[] = [];
  const pick = (alphabet: string) => {
    const limit = 256 - (256 % alphabet.length);
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return alphabet[buf[0] % alphabet.length];
    }
  };
  for (let i = 0; i < length - 2; i++) chars.push(pick(PASSWORD_ALPHABET));
  chars.push(pick(PASSWORD_SYMBOLS), pick('23456789'));
  // Fisher–Yates shuffle so the symbol/digit positions are not fixed.
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const STATUS_LABEL: Record<AccessStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
  expired: 'Expired',
};
