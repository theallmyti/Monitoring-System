// Password hashing and session tokens (docs/Security.md §3–4).
// scrypt via @noble/hashes 1.8 (audited, pure JS: runs in Convex actions and in tests).
// Format: scrypt$N$r$p$<salt base64>$<key base64>. N = 2^15, r = 8, p = 1 uses 32 MiB,
// inside the Convex function memory limit.
import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function toB64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function hashPassword(password: string): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = scrypt(utf8ToBytes(password), salt, { N, r: R, p: P, dkLen: KEY_LEN });
  return `scrypt$${N}$${R}$${P}$${toB64(salt)}$${toB64(key)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, key] = parts;
  const expected = fromB64(key);
  const actual = scrypt(utf8ToBytes(password), fromB64(salt), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    dkLen: expected.length,
  });
  return sameBytes(actual, expected);
}

// Random 256-bit session token, sent once to the browser/app. Only its SHA-256 is stored.
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function tokenHash(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

// Used when the email is unknown, so a wrong email takes as long as a wrong password
// (no account enumeration through timing, docs/Security.md §2).
let dummy: string | null = null;
export function dummyHash(): string {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
}
