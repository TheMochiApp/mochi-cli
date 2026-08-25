import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { CliError, ExitCode } from "../core/errors.js";
import { ensureOwnerOnlyDirectory } from "./file-store.js";

const RETRY_DELAY_MS = 50;
const ACQUISITION_DEADLINE_MS = 10_000;
const STALE_AFTER_MS = 60_000;

interface LockRecord {
  nonce: string;
  acquiredAt: number;
}

interface LockSnapshot {
  contents: string;
  record: LockRecord | null;
  mtimeMs: number;
  device: bigint;
  inode: bigint;
}

export interface CredentialLockOptions {
  now?: () => number;
  nonce?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  renameFile?: (source: string, destination: string) => Promise<void>;
}

export async function withCredentialLock<Result>(
  lockPath: string,
  callback: () => Promise<Result>,
  options: CredentialLockOptions = {},
): Promise<Result> {
  const now = options.now ?? Date.now;
  const createNonce = options.nonce ?? (() => randomBytes(32).toString("hex"));
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const renameFile = options.renameFile ?? rename;
  const startedAt = now();
  const nonce = createNonce();
  const claimPath = `${lockPath}.claim`;
  const guardPath = `${lockPath}.guard`;

  await ensureOwnerOnlyDirectory(dirname(lockPath));
  while (true) {
    const guardNonce = await acquireGuard(guardPath, now, renameFile);
    if (guardNonce) {
      let acquired = false;
      try {
        await recoverOrphanedClaim(lockPath, claimPath, now());
        const existing = await readTrustedLock(lockPath);
        if (existing) {
          await claimAndResolve(lockPath, claimPath, renameFile, {
            currentTime: now(),
            removeWhen: (snapshot) => isStale(snapshot, now()),
          });
        } else {
          acquired = await tryCreateLock(lockPath, nonce, now);
          if (acquired && (await readTrustedLock(claimPath))) {
            throw lockFailure("A credential cleanup claim is still active.");
          }
        }
      } finally {
        await releaseGuard(guardPath, guardNonce, renameFile);
      }

      if (acquired) {
        break;
      }
    }

    if (now() - startedAt >= ACQUISITION_DEADLINE_MS) {
      throw new CliError(
        "CREDENTIAL_LOCK_TIMEOUT",
        "Timed out waiting for another Mochi process to finish updating credentials.",
        ExitCode.Local,
      );
    }
    await sleep(RETRY_DELAY_MS);
  }

  try {
    return await callback();
  } finally {
    await releaseOwnedLock(lockPath, claimPath, `${lockPath}.guard`, nonce, now, sleep, renameFile);
  }
}

async function acquireGuard(
  guardPath: string,
  now: () => number,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<string | null> {
  const nonce = randomBytes(32).toString("hex");
  let handle;
  try {
    handle = await open(guardPath, "wx", 0o600);
    const record: LockRecord = { nonce, acquiredAt: now() };
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
    return nonce;
  } catch (error) {
    if (!isFileError(error, "EEXIST")) {
      throw lockFailure("Could not acquire the credential cleanup guard.");
    }
  } finally {
    await handle?.close();
  }

  const existing = await readTrustedLock(guardPath);
  if (existing && isStale(existing, now())) {
    const staleClaim = `${guardPath}.stale.${randomBytes(16).toString("hex")}`;
    try {
      await renameFile(guardPath, staleClaim);
    } catch (error) {
      if (isFileError(error, "ENOENT")) {
        return null;
      }
      throw lockFailure("Could not inspect a stale credential cleanup guard.");
    }
    const claimed = await readTrustedLock(staleClaim);
    if (claimed && sameFile(existing, claimed) && isStale(claimed, now())) {
      await unlink(staleClaim);
    } else if (claimed) {
      await restoreSnapshot(staleClaim, guardPath, claimed);
    }
  }
  return null;
}

async function releaseGuard(
  guardPath: string,
  nonce: string,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const releasePath = `${guardPath}.release.${randomBytes(16).toString("hex")}`;
  try {
    await renameFile(guardPath, releasePath);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return;
    }
    throw lockFailure("Could not release the credential cleanup guard.");
  }
  const claimed = await readTrustedLock(releasePath);
  if (claimed?.record?.nonce === nonce) {
    await unlink(releasePath);
    return;
  }
  if (claimed) {
    await restoreSnapshot(releasePath, guardPath, claimed);
  }
  throw lockFailure("Credential cleanup guard ownership changed unexpectedly.");
}

async function tryCreateLock(lockPath: string, nonce: string, now: () => number): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    const record: LockRecord = { nonce, acquiredAt: now() };
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if (isFileError(error, "EEXIST")) {
      return false;
    }
    throw lockFailure("Could not secure Mochi credentials.");
  } finally {
    await handle?.close();
  }
}

async function releaseOwnedLock(
  lockPath: string,
  claimPath: string,
  guardPath: string,
  nonce: string,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const startedAt = now();
  while (true) {
    const guardNonce = await acquireGuard(guardPath, now, renameFile);
    if (guardNonce) {
      try {
        await recoverOrphanedClaim(lockPath, claimPath, now());
        await claimAndResolve(lockPath, claimPath, renameFile, {
          expectedNonce: nonce,
          currentTime: now(),
          removeWhen: (snapshot) => snapshot.record?.nonce === nonce,
        });
        return;
      } finally {
        await releaseGuard(guardPath, guardNonce, renameFile);
      }
    }
    if (now() - startedAt >= ACQUISITION_DEADLINE_MS) {
      throw lockFailure("Timed out while releasing the Mochi credential lock.");
    }
    await sleep(RETRY_DELAY_MS);
  }
}

interface ClaimResolution {
  expectedNonce?: string;
  currentTime: number;
  removeWhen: (snapshot: LockSnapshot) => boolean;
}

async function claimAndResolve(
  lockPath: string,
  claimPath: string,
  renameFile: (source: string, destination: string) => Promise<void>,
  resolution: ClaimResolution,
): Promise<boolean> {
  try {
    await renameFile(lockPath, claimPath);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return false;
    }
    throw lockFailure("Could not atomically claim the Mochi credential lock.");
  }

  let claimed: LockSnapshot;
  try {
    claimed = requireSnapshot(await readTrustedLock(claimPath));
  } catch (error) {
    await restoreClaimPath(claimPath, lockPath);
    throw error;
  }

  if (resolution.removeWhen(claimed)) {
    await unlink(claimPath);
    return true;
  }

  await restoreSnapshot(claimPath, lockPath, claimed);
  if (resolution.expectedNonce && claimed.record?.nonce !== resolution.expectedNonce) {
    return false;
  }
  return false;
}

async function recoverOrphanedClaim(lockPath: string, claimPath: string, currentTime: number): Promise<void> {
  const claim = await readTrustedLock(claimPath);
  if (!claim) {
    return;
  }
  if (isStale(claim, currentTime)) {
    await unlink(claimPath);
    return;
  }
  if (await pathExists(lockPath)) {
    throw lockFailure("Conflicting credential lock and cleanup claim found.");
  }
  await restoreSnapshot(claimPath, lockPath, claim);
}

async function restoreSnapshot(claimPath: string, lockPath: string, snapshot: LockSnapshot): Promise<void> {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(snapshot.contents, "utf8");
    await handle.sync();
  } catch {
    throw lockFailure("Could not safely restore a claimed credential lock.");
  } finally {
    await handle?.close();
  }
  await unlink(claimPath);
}

async function restoreClaimPath(claimPath: string, lockPath: string): Promise<void> {
  if (await pathExists(lockPath)) {
    throw unsafeLock();
  }
  await rename(claimPath, lockPath);
}

async function readTrustedLock(path: string): Promise<LockSnapshot | null> {
  let pathStats;
  try {
    pathStats = await lstat(path, { bigint: true });
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return null;
    }
    throw lockFailure("Could not inspect the Mochi credential lock.");
  }
  validateTrustedLockStats(pathStats);

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return null;
    }
    if (isFileError(error, "ELOOP")) {
      throw unsafeLock();
    }
    throw lockFailure("Could not inspect the Mochi credential lock.");
  }

  try {
    const stats = await handle.stat({ bigint: true });
    validateTrustedLockStats(stats);
    if (pathStats.dev !== stats.dev || pathStats.ino !== stats.ino) {
      throw unsafeLock();
    }
    const contents = await handle.readFile("utf8");
    return {
      contents,
      record: parseLockRecord(contents),
      mtimeMs: Number(stats.mtimeMs),
      device: stats.dev,
      inode: stats.ino,
    };
  } finally {
    await handle.close();
  }
}

function validateTrustedLockStats(stats: BigIntStats): void {
  if (!stats.isFile() || !isOwnedByCurrentUser(stats.uid) || (Number(stats.mode) & 0o777) !== 0o600) {
    throw unsafeLock();
  }
}

function parseLockRecord(contents: string): LockRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "acquiredAt,nonce" ||
    typeof (value as Record<string, unknown>).nonce !== "string" ||
    (value as Record<string, string>).nonce.length === 0 ||
    typeof (value as Record<string, unknown>).acquiredAt !== "number" ||
    !Number.isFinite((value as Record<string, number>).acquiredAt)
  ) {
    return null;
  }
  return {
    nonce: (value as Record<string, string>).nonce,
    acquiredAt: (value as Record<string, number>).acquiredAt,
  };
}

function isStale(snapshot: LockSnapshot, currentTime: number): boolean {
  const timestamp = snapshot.record?.acquiredAt ?? snapshot.mtimeMs;
  return currentTime - timestamp > STALE_AFTER_MS;
}

function sameFile(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return false;
    }
    throw lockFailure("Could not inspect the Mochi credential lock path.");
  }
}

function requireSnapshot(snapshot: LockSnapshot | null): LockSnapshot {
  if (!snapshot) {
    throw lockFailure("A claimed credential lock disappeared unexpectedly.");
  }
  return snapshot;
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function isOwnedByCurrentUser(uid: bigint): boolean {
  return typeof process.getuid !== "function" || uid === BigInt(process.getuid());
}

function unsafeLock(): CliError {
  return new CliError(
    "CREDENTIAL_LOCK_UNSAFE",
    "Credential locks must be owner-only regular files in the Mochi config directory.",
    ExitCode.Local,
  );
}

function lockFailure(message: string): CliError {
  return new CliError("CREDENTIAL_LOCK_FAILED", message, ExitCode.Local);
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
