import { randomBytes } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
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

export interface CredentialLockOptions {
  now?: () => number;
  nonce?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function withCredentialLock<Result>(
  lockPath: string,
  callback: () => Promise<Result>,
  options: CredentialLockOptions = {},
): Promise<Result> {
  const now = options.now ?? Date.now;
  const createNonce = options.nonce ?? (() => randomBytes(32).toString("hex"));
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const record: LockRecord = { nonce: createNonce(), acquiredAt: startedAt };

  await ensureOwnerOnlyDirectory(dirname(lockPath));
  while (!(await tryAcquire(lockPath, record))) {
    await removeIfStale(lockPath, now());
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
    await releaseIfOwned(lockPath, record.nonce);
  }
}

async function tryAcquire(lockPath: string, record: LockRecord): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if (isFileError(error, "EEXIST")) {
      return false;
    }
    throw new CliError("CREDENTIAL_LOCK_FAILED", "Could not secure Mochi credentials.", ExitCode.Local);
  } finally {
    await handle?.close();
  }
}

async function removeIfStale(lockPath: string, currentTime: number): Promise<void> {
  const initial = await readLock(lockPath);
  if (!initial || currentTime - initial.acquiredAt <= STALE_AFTER_MS) {
    return;
  }

  const verified = await readLock(lockPath);
  if (verified?.nonce === initial.nonce && verified.acquiredAt === initial.acquiredAt) {
    await unlink(lockPath).catch((error: unknown) => {
      if (!isFileError(error, "ENOENT")) {
        throw new CliError("CREDENTIAL_LOCK_FAILED", "Could not secure Mochi credentials.", ExitCode.Local);
      }
    });
  }
}

async function releaseIfOwned(lockPath: string, nonce: string): Promise<void> {
  const current = await readLock(lockPath);
  if (current?.nonce !== nonce) {
    return;
  }
  await unlink(lockPath).catch((error: unknown) => {
    if (!isFileError(error, "ENOENT")) {
      throw new CliError("CREDENTIAL_LOCK_FAILED", "Could not release Mochi credentials.", ExitCode.Local);
    }
  });
}

async function readLock(lockPath: string): Promise<LockRecord | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (isFileError(error, "ENOENT") || error instanceof SyntaxError) {
      return null;
    }
    throw new CliError("CREDENTIAL_LOCK_FAILED", "Could not inspect the Mochi credential lock.", ExitCode.Local);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).nonce !== "string" ||
    !Number.isFinite((value as Record<string, unknown>).acquiredAt)
  ) {
    return null;
  }
  return {
    nonce: (value as Record<string, string>).nonce,
    acquiredAt: (value as Record<string, number>).acquiredAt,
  };
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
