// cloudDocs.js — what a saved layout looks like in the cloud, as pure functions.
//
// A saved layout is stored in Firestore as two documents that share one id:
//
//   users/{uid}/layouts/{id}     { name, schemaVersion, bytes, createdAt, updatedAt }
//   users/{uid}/layoutData/{id}  { data }
//
// The split matters: "My layouts" only ever reads the small metadata documents,
// so listing forty layouts does not drag forty copies of the plan down the wire.
//
// `data` is the same db_connect JSON that Export JSON writes, minus the derived
// `bins` array — fromDbConnect never reads bins (they are recomputed from the
// racks), and dropping them keeps a large warehouse comfortably inside
// Firestore's 1 MiB per-document limit.
//
// Pure: no Firebase, no DOM, so the naming and size rules are unit-testable.

import { toDbConnect, fromDbConnect } from './dbconnect.js';
import { migrate } from './migrations.js';

// Firestore's hard limit is 1 MiB per document; warn well before that.
export const MAX_DOC_BYTES = 900 * 1024;
export const MAX_NAME = 60;

export function cleanName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Null when the name is usable, otherwise a message for the user. `taken` is the
// list of names already saved, compared case-insensitively.
export function nameError(raw, taken = []) {
  const name = cleanName(raw);
  if (!name) return 'Give the layout a name.';
  if (name.length > MAX_NAME) return `Names are limited to ${MAX_NAME} characters.`;
  const clash = taken.some((t) => cleanName(t).toLowerCase() === name.toLowerCase());
  if (clash) return `“${name}” is already saved — open it, or pick another name.`;
  return null;
}

// The metadata half of a save, plus the payload that goes in the data document.
export function cloudDoc(state, name) {
  const data = toDbConnect(state, { includeBins: false });
  return {
    meta: {
      name: cleanName(name),
      schemaVersion: data.editor?.schemaVersion ?? 7,
      bytes: JSON.stringify(data).length,
    },
    data,
  };
}

// Payload size in bytes — what the 1 MiB limit applies to.
export function docBytes(data) {
  return JSON.stringify(data).length;
}

export function fitsInDoc(data) {
  return docBytes(data) <= MAX_DOC_BYTES;
}

// Editor-native state from a stored payload. The caller merges the shipped
// defaults underneath it, exactly as Import JSON does.
export function layoutFromDoc(data) {
  return fromDbConnect(migrate(data));
}

// One row for the "My layouts" list.
export function docSummary(id, meta, fallbackName = 'Untitled layout') {
  return {
    id,
    name: cleanName(meta?.name) || fallbackName,
    schemaVersion: meta?.schemaVersion ?? null,
    bytes: Number.isFinite(meta?.bytes) ? meta.bytes : null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// "3 minutes ago" style, from a Firestore Timestamp, a Date or an ISO string.
export function formatWhen(value, now = Date.now()) {
  const ms = toMillis(value);
  if (ms === null) return '—';
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ms).toLocaleDateString();
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value.toMillis === 'function') return value.toMillis(); // Firestore Timestamp
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

// Friendly text for the errors Firebase throws, so the modal never shows a bare
// error code. Anything unrecognised falls through to its own message.
export function friendlyError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Passwords need at least 6 characters.',
    'auth/email-already-in-use': 'That email already has an account — sign in instead.',
    'auth/user-not-found': 'No account with that email.',
    'auth/wrong-password': 'Wrong password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/too-many-requests': 'Too many attempts — wait a moment and try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'The browser blocked the sign-in popup — allow popups and retry.',
    'auth/network-request-failed': 'No connection to Firebase — check your network.',
    'auth/operation-not-allowed': 'That sign-in method is not enabled for this project.',
    'auth/unauthorized-domain':
      'This site is not authorised in Firebase yet — add this domain under Authentication → Settings → Authorized domains.',
    'permission-denied': 'Firebase refused the request — check the Firestore rules for this project.',
    unavailable: 'Firestore is unreachable — check your connection.',
    'not-found': 'That saved layout no longer exists.',
    'resource-exhausted': 'The layout is too large for Firestore.',
  };
  for (const key of Object.keys(map)) {
    if (code === key || code.endsWith(key)) return map[key];
  }
  // The SDK reports a bad key with a long, shouted code.
  if (/api[-_]?key/i.test(code) || /api[-_]?key/i.test(String(err?.message ?? ''))) {
    return 'The Firebase API key looks wrong — check app/js/firebase-config.js.';
  }
  return err?.message ? String(err.message) : 'Something went wrong.';
}
