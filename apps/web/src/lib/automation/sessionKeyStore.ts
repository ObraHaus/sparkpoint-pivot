/**
 * Durable, ENCRYPTED-at-rest store for the client's session private key (US6, feature 022).
 *
 * The session key is a fresh, single-purpose keypair generated in the browser (`grant/page.tsx`) —
 * NEVER the user's wallet key — whose blast radius is bounded on-chain by the grant's allowlist +
 * per-tx cap + cumulative cap + expiry, and killable by instant unilateral revoke (N2). Only the
 * public address ever leaves the device (N3). This store lets that key survive navigation/reload so
 * an approved in-scope move can be signed later with no wallet prompt.
 *
 * At-rest posture (operator-chosen): the private key is AES-GCM encrypted in IndexedDB under a
 * wrapping key DERIVED (HKDF-SHA256) from a ONE-TIME-PER-BROWSER-SESSION wallet signature over a fixed,
 * non-transactional domain message. So a stolen disk / localStorage snapshot ALONE cannot sign — it
 * needs the wallet to re-sign the unlock message. The derived `CryptoKey` is non-extractable and cached
 * only in memory (gone on tab close). This is a session UNLOCK, not a per-move signature — Gate C
 * intact (no autonomy; every move is still an explicit click).
 *
 * Determinism note: the unlock relies on the wallet producing a deterministic ECDSA `personal_sign`
 * (RFC-6979 — MetaMask/Coinbase/Rainbow/etc. do). If a wallet ever returns a non-deterministic
 * signature, the re-derived key won't decrypt a prior record → `getSessionKey` returns `null` and the
 * user simply re-grants; nothing is corrupted and no move can fire on a bad key.
 *
 * SSR/private-mode safe: every op is a no-op / `null` when IndexedDB or WebCrypto is unavailable, and
 * NOTHING here ever throws into the UI (mirrors `useLocalState`). Wipe is never gated (N2).
 */

import { hexToBytes, type Hex } from "viem";

const DB_NAME = "sp-session-keys";
const STORE = "keys";
const DB_VERSION = 1;
/** Versioned namespace — bump if the record shape or crypto changes. */
const SCOPE_PREFIX = "sp.session.key.v1";
/** Fixed HKDF salt/info — stable so the same wallet signature always derives the same wrapping key. */
const HKDF_SALT = new TextEncoder().encode("sp.session.unlock.v1");
const HKDF_INFO = new TextEncoder().encode("sp-session-key-aes-gcm");

/** The (chain, smart-account, session-address) a key is bound to — the scope of one grant. */
export interface KeyScope {
  chainId: number;
  account: string;
  sessionAddress: string;
}

interface KeyRecord {
  scope: string;
  account: string;
  chainId: number;
  sessionAddress: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  createdAt: number;
}

/** The versioned IndexedDB key for a scope (account+chain lower-cased so lookups are case-stable). */
export function scopeKey(s: KeyScope): string {
  return `${SCOPE_PREFIX}:${s.chainId}:${s.account.toLowerCase()}:${s.sessionAddress.toLowerCase()}`;
}

/**
 * The fixed, non-transactional message the wallet signs ONCE per browser session to unlock the
 * on-device automation key. It authorizes NO move — it only derives the local encryption key.
 */
export function unlockMessage(account: string, chainId: number): string {
  return [
    "SparkPoint — unlock on-device automation key",
    "",
    `Account: ${account.toLowerCase()}`,
    `Chain: ${chainId}`,
    "",
    "Signing this unlocks the automation key stored in THIS browser so approved,",
    "in-scope moves can run without a wallet prompt. It does NOT authorize any move,",
    "transfer, or approval, and never leaves your device.",
  ].join("\n");
}

function cryptoAvailable(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

/**
 * Derive the non-extractable AES-GCM wrapping key from a wallet unlock signature (HKDF-SHA256).
 * Pure crypto — the caller obtains the signature (once per session) and caches the result.
 */
export async function deriveUnlockKey(signature: Hex): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    hexToBytes(signature) as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT as unknown as BufferSource,
      info: HKDF_INFO as unknown as BufferSource,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable — the raw wrapping key never leaves WebCrypto
    ["encrypt", "decrypt"],
  );
}

/* ── in-memory unlock cache (one derived key per (account,chain), gone on tab close) ── */

const unlockCache = new Map<string, CryptoKey>();

function cacheId(account: string, chainId: number): string {
  return `${chainId}:${account.toLowerCase()}`;
}

/** Cache a derived unlock key for this browser session so the wallet is asked to sign only once. */
export function cacheUnlockKey(account: string, chainId: number, key: CryptoKey): void {
  unlockCache.set(cacheId(account, chainId), key);
}

/** The cached unlock key for (account,chain), or `undefined` if this session hasn't unlocked yet. */
export function getCachedUnlockKey(account: string, chainId: number): CryptoKey | undefined {
  return unlockCache.get(cacheId(account, chainId));
}

/** Drop all cached unlock keys (e.g. on disconnect) — records stay, but must be re-unlocked. */
export function clearUnlockCache(): void {
  unlockCache.clear();
}

/* ── IndexedDB access (promise-wrapped, never throws into the UI) ── */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "scope" });
          os.createIndex("account", "account", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* ── public API ── */

/**
 * Encrypt + persist the session private key for `scope` under the derived `unlockKey`. No-op (returns
 * `false`) if crypto/IndexedDB is unavailable. Callers persist ONLY after the grant tx confirms, so an
 * aborted grant leaves no orphan key.
 */
export async function putSessionKey(
  scope: KeyScope,
  privateKey: Hex,
  unlockKey: CryptoKey,
): Promise<boolean> {
  if (!cryptoAvailable()) return false;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      unlockKey,
      new TextEncoder().encode(privateKey) as unknown as BufferSource,
    );
    const db = await openDb();
    if (!db) return false;
    const record: KeyRecord = {
      scope: scopeKey(scope),
      account: scope.account.toLowerCase(),
      chainId: scope.chainId,
      sessionAddress: scope.sessionAddress.toLowerCase(),
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      ciphertext,
      createdAt: Date.now(),
    };
    await tx(db, "readwrite", (s) => s.put(record));
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Decrypt the session private key for `scope` under `unlockKey`. Returns `null` if absent, if crypto
 * is unavailable, or if decryption fails (wrong/rotated unlock key) — never throws. A `null` here is
 * honest: the caller routes the user to per-action signing / re-grant, never a fabricated key.
 */
export async function getSessionKey(scope: KeyScope, unlockKey: CryptoKey): Promise<Hex | null> {
  if (!cryptoAvailable()) return null;
  try {
    const db = await openDb();
    if (!db) return null;
    const record = (await tx<KeyRecord>(db, "readonly", (s) => s.get(scopeKey(scope)) as IDBRequest<KeyRecord>)) ?? null;
    db.close();
    if (!record) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv as unknown as BufferSource },
      unlockKey,
      record.ciphertext as unknown as BufferSource,
    );
    const pk = new TextDecoder().decode(plain);
    return /^0x[0-9a-fA-F]{64}$/.test(pk) ? (pk as Hex) : null;
  } catch {
    return null;
  }
}

/** Whether a key record EXISTS for `scope` — presence only, no decryption (so no unlock needed). */
export async function hasSessionKey(scope: KeyScope): Promise<boolean> {
  if (!cryptoAvailable()) return false;
  const db = await openDb();
  if (!db) return false;
  const key = await tx<IDBValidKey>(db, "readonly", (s) => s.getKey(scopeKey(scope)) as IDBRequest<IDBValidKey>);
  db.close();
  return key != null;
}

/**
 * Delete the key record for `scope`. NEVER gated (N2): revoke/expiry wiping the local key is a
 * consequence of the sacred exit, never a thing that can block it. No unlock required to wipe.
 */
export async function wipeSessionKey(scope: KeyScope): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  if (!db) return;
  await tx(db, "readwrite", (s) => s.delete(scopeKey(scope)));
  db.close();
}

/** Delete ALL session-key records for `account` (any chain/session) — e.g. on a hard reset. */
export async function wipeAccountKeys(account: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  if (!db) return;
  const keys = await tx<IDBValidKey[]>(
    db,
    "readonly",
    (s) => s.index("account").getAllKeys(account.toLowerCase()) as IDBRequest<IDBValidKey[]>,
  );
  if (keys && keys.length > 0) {
    await Promise.all(keys.map((k) => tx(db, "readwrite", (s) => s.delete(k))));
  }
  db.close();
}
