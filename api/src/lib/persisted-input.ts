import { db } from '../db';
import { isValidLanguageCode } from './languages';
import { utf8Bytes, validatePersistedId } from './storage-limits';

export const MAX_PERSISTED_TIMESTAMP_BYTES = 64;

type NumericOptions = {
  optional?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
};

function missingValueError(field: string): string {
  return `${field} is required`;
}

export function validateSafeInteger(
  value: unknown,
  field: string,
  options: NumericOptions = {},
): string | null {
  if (value === undefined) return options.optional === false ? missingValueError(field) : null;
  if (value === null) return options.nullable ? null : `${field} must be a safe integer`;
  if (!Number.isSafeInteger(value)) return `${field} must be a safe integer`;

  const number = value as number;
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (number < min || number > max) {
    return `${field} must be between ${min} and ${max}`;
  }
  return null;
}

export function validateFiniteNumber(
  value: unknown,
  field: string,
  options: NumericOptions = {},
): string | null {
  if (value === undefined) return options.optional === false ? missingValueError(field) : null;
  if (value === null) return options.nullable ? null : `${field} must be a finite number`;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${field} must be a finite number`;
  }

  const min = options.min ?? -Number.MAX_VALUE;
  const max = options.max ?? Number.MAX_VALUE;
  if (value < min || value > max) return `${field} must be between ${min} and ${max}`;
  return null;
}

export function validateTimestamp(
  value: unknown,
  field: string,
  options: Pick<NumericOptions, 'optional' | 'nullable'> = {},
): string | null {
  if (value === undefined) return options.optional === false ? missingValueError(field) : null;
  if (value === null) return options.nullable ? null : `${field} must be a timestamp`;
  if (
    typeof value !== 'string' ||
    utf8Bytes(value) > MAX_PERSISTED_TIMESTAMP_BYTES ||
    Number.isNaN(Date.parse(value))
  ) {
    return `${field} must be a parseable timestamp of at most ${MAX_PERSISTED_TIMESTAMP_BYTES} UTF-8 bytes`;
  }
  return null;
}

export function validateDateKey(
  value: unknown,
  field: string,
  options: Pick<NumericOptions, 'optional'> = {},
): string | null {
  if (value === undefined) return options.optional === false ? missingValueError(field) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${field} must be a valid YYYY-MM-DD date`;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return `${field} must be a valid YYYY-MM-DD date`;
  }
  return null;
}

export function validateBooleanLike(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  return value === true || value === false || value === 0 || value === 1
    ? null
    : `${field} must be a boolean`;
}

export function booleanLikeToSql(value: boolean | 0 | 1): 0 | 1 {
  return value === true || value === 1 ? 1 : 0;
}

export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
  options: Pick<NumericOptions, 'optional' | 'nullable'> = {},
): string | null {
  if (value === undefined) return options.optional === false ? missingValueError(field) : null;
  if (value === null) return options.nullable ? null : `${field} is invalid`;
  return typeof value === 'string' && allowed.has(value as T) ? null : `${field} is invalid`;
}

export function validateOptionalLanguage(value: unknown, field = 'language'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && isValidLanguageCode(value)
    ? null
    : `${field} must be a supported language`;
}

export function validateWordKey(value: unknown, field = 'word'): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${field} must be a non-empty string`;
  }
  if (/[\u0000-\u001f]/.test(value)) return `${field} must not contain control characters`;
  return null;
}

export type OwnedReferenceTable = 'collection_groups' | 'collections' | 'lessons' | 'vocab';

const REFERENCE_LABELS: Record<OwnedReferenceTable, string> = {
  collection_groups: 'group',
  collections: 'collection',
  lessons: 'lesson',
  vocab: 'vocab entry',
};

/** Validate a stored relation and make tenant ownership part of the write contract.
 * Foreign-key enforcement is intentionally off in this database, so direct
 * routes must reject dangling and cross-tenant ids themselves. */
export function validateOwnedReference(
  table: OwnedReferenceTable,
  value: unknown,
  userId: string,
  field: string,
  options: { optional?: boolean; nullable?: boolean } = {},
): string | null {
  const optional = options.optional ?? true;
  const nullable = options.nullable ?? true;
  if (value === undefined) return optional ? null : missingValueError(field);
  if (value === null) return nullable ? null : `${field} is required`;

  const idError = validatePersistedId(value);
  if (idError) return `${field}: ${idError}`;

  const row = db
    .prepare(`SELECT 1 FROM ${table} WHERE userId = ? AND id = ?`)
    .get(userId, value as string);
  return row ? null : `${field} must reference one of your ${REFERENCE_LABELS[table]}s`;
}
