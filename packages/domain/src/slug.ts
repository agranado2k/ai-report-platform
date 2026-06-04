// Slug — the permanent, URL-safe nanoid(10) identifier for a Report, and (in
// public ACL mode) the access capability (ADR-0038). Value Object with a smart
// constructor: a Slug only exists if it matches the nanoid alphabet + length.

import type { Brand } from './brand';
import type { AppError } from './errors';
import type { Result } from './result';
import { validationError } from './errors';
import { err, ok } from './result';

export type Slug = Brand<string, 'Slug'>;

// nanoid default alphabet: A-Za-z0-9_- (64 chars), length 10.
const SLUG_RE = /^[A-Za-z0-9_-]{10}$/;

export const makeSlug = (raw: string): Result<Slug, AppError> =>
  SLUG_RE.test(raw)
    ? ok(raw as Slug)
    : err(validationError('slug must be a 10-character URL-safe id', 'slug'));
