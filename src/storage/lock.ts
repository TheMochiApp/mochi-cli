import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { CliError, ExitCode } from "../core/errors.js";
import { ensureOwnerOnlyDirectory } from "./file-store.js";

const RETRY_DELAY_MS = 50;
const ACQUISITION_DEADLINE_MS = 10_000;
const STALE_AFTER_MS = 60_000;
const OWNER_FILE = "owner";

class LeaseMissingError extends Error {}

interface LeaseRecord {
  nonce: string;
  acquiredAt: number;
}

interface LeaseSnapshot {
  contents: string | null;
  record: LeaseRecord | null;
  modifiedAt: number;
  changedAt: number;
  directoryDevice: bigint;
  directoryInode: bigint;
  ownerDevice: bigint | null;
  ownerInode: bigint | null;
}

export interface CredentialLockOptions {
  now?: () => number;
  nonce?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  platform?: NodeJS.Platform;
  afterPreliminaryInspectionForTests?: () => Promise<void>;
}

export async function withCredentialLock<Result>(
  lockPath: string,
  callback: () => Promise<Result>,
  options: CredentialLockOptions = {},
): Promise<Result> {
  const now = options.now ?? Date.now;
  const nonce = (options.nonce ?? (() => randomBytes(32).toString("hex")))();
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const renameFile = options.renameFile ?? rename;
  const platform = options.platform ?? process.platform;
  const startedAt = now();

  await ensureOwnerOnlyDirectory(dirname(lockPath), platform);
  while (
    !(await tryAcquireLease(lockPath, nonce, now, platform, renameFile, options.afterPreliminaryInspectionForTests))
  ) {
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
    await releaseLease(lockPath, nonce, platform, renameFile);
  }
}

async function tryAcquireLease(
  lockPath: string,
  nonce: string,
  now: () => number,
  platform: NodeJS.Platform,
  renameFile: (source: string, destination: string) => Promise<void>,
  afterPreliminaryInspection: (() => Promise<void>) | undefined,
): Promise<boolean> {
  if (await recoverClaims(lockPath, now(), platform, renameFile)) {
    return false;
  }

  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (!isFileError(error, "EEXIST")) {
      throw lockFailure("Could not create the Mochi credential lease.");
    }
    await resolveFixedLease(lockPath, now(), platform, renameFile, afterPreliminaryInspection);
    return false;
  }

  try {
    await writeOwnerRecord(lockPath, { nonce, acquiredAt: now() });
    const initialized = await inspectLease(lockPath, platform);
    if (initialized.record?.nonce !== nonce) {
      throw unsafeLock();
    }

    if ((await listClaimPaths(lockPath)).length > 0) {
      await withdrawOwnedLease(lockPath, nonce, platform, renameFile);
      return false;
    }

    const revalidated = await inspectLease(lockPath, platform);
    if (revalidated.record?.nonce !== nonce) {
      await withdrawOwnedLease(lockPath, nonce, platform, renameFile);
      return false;
    }
    return true;
  } catch (error) {
    await withdrawOwnedLease(lockPath, nonce, platform, renameFile).catch(() => undefined);
    throw error;
  }
}

async function resolveFixedLease(
  lockPath: string,
  currentTime: number,
  platform: NodeJS.Platform,
  renameFile: (source: string, destination: string) => Promise<void>,
  afterPreliminaryInspection: (() => Promise<void>) | undefined,
): Promise<void> {
  let observed: LeaseSnapshot;
  try {
    observed = await inspectLease(lockPath, platform);
  } catch (error) {
    if (error instanceof LeaseMissingError) {
      return;
    }
    throw error;
  }
  await afterPreliminaryInspection?.();
  if (!isStale(observed, currentTime)) {
    return;
  }

  const claimPath = uniqueClaimPath(lockPath);
  try {
    await renameFile(lockPath, claimPath);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return;
    }
    throw lockFailure("Could not atomically claim the Mochi credential lease.");
  }

  let claimed: LeaseSnapshot;
  try {
    claimed = await inspectLease(claimPath, platform);
  } catch (error) {
    if (error instanceof LeaseMissingError) {
      return;
    }
    throw error;
  }
  if (sameLease(observed, claimed) && isStale(claimed, currentTime)) {
    await removeClaim(claimPath, claimed);
    return;
  }
  await restoreClaim(claimPath, lockPath, claimed, platform);
}

async function releaseLease(
  lockPath: string,
  nonce: string,
  platform: NodeJS.Platform,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const claimPath = uniqueClaimPath(lockPath);
  try {
    await renameFile(lockPath, claimPath);
  } catch (error) {
    if (!isFileError(error, "ENOENT")) {
      throw lockFailure("Could not atomically claim the Mochi credential lease for release.");
    }
    await removeOwnedClaims(lockPath, nonce, platform);
    return;
  }

  let claimed: LeaseSnapshot;
  try {
    claimed = await inspectLease(claimPath, platform);
  } catch (error) {
    if (error instanceof LeaseMissingError) {
      await removeOwnedClaims(lockPath, nonce, platform);
      return;
    }
    throw error;
  }
  if (claimed.record?.nonce === nonce) {
    await removeClaim(claimPath, claimed);
  } else {
    await restoreClaim(claimPath, lockPath, claimed, platform);
    await removeOwnedClaims(lockPath, nonce, platform);
  }
}

async function withdrawOwnedLease(
  lockPath: string,
  nonce: string,
  platform: NodeJS.Platform,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const claimPath = uniqueClaimPath(lockPath);
  try {
    await renameFile(lockPath, claimPath);
  } catch (error) {
    if (!isFileError(error, "ENOENT")) {
      throw lockFailure("Could not withdraw the Mochi credential lease.");
    }
    await removeOwnedClaims(lockPath, nonce, platform);
    return;
  }

  let claimed: LeaseSnapshot;
  try {
    claimed = await inspectLease(claimPath, platform);
  } catch (error) {
    if (error instanceof LeaseMissingError) {
      await removeOwnedClaims(lockPath, nonce, platform);
      return;
    }
    throw error;
  }
  if (claimed.record?.nonce === nonce) {
    await removeClaim(claimPath, claimed);
  } else {
    await restoreClaim(claimPath, lockPath, claimed, platform);
    await removeOwnedClaims(lockPath, nonce, platform);
  }
}

async function recoverClaims(
  lockPath: string,
  currentTime: number,
  platform: NodeJS.Platform,
  renameFile: (source: string, destination: string) => Promise<void>,
): Promise<boolean> {
  let activeClaim = false;
  for (const claimPath of await listClaimPaths(lockPath)) {
    let observed: LeaseSnapshot;
    try {
      observed = await inspectLease(claimPath, platform);
    } catch (error) {
      if (error instanceof LeaseMissingError) {
        continue;
      }
      throw error;
    }
    if (currentTime - observed.changedAt <= STALE_AFTER_MS) {
      activeClaim = true;
      continue;
    }

    const recoveryPath = uniqueClaimPath(lockPath);
    try {
      await renameFile(claimPath, recoveryPath);
    } catch (error) {
      if (isFileError(error, "ENOENT")) {
        continue;
      }
      throw lockFailure("Could not atomically recover an abandoned lease claim.");
    }
    let recovered: LeaseSnapshot;
    try {
      recovered = await inspectLease(recoveryPath, platform);
    } catch (error) {
      if (error instanceof LeaseMissingError) {
        continue;
      }
      throw error;
    }
    if (isStale(recovered, currentTime)) {
      await removeClaim(recoveryPath, recovered);
    } else if (!(await restoreClaim(recoveryPath, lockPath, recovered, platform))) {
      activeClaim = true;
    }
  }
  return activeClaim || (await listClaimPaths(lockPath)).length > 0;
}

async function removeOwnedClaims(lockPath: string, nonce: string, platform: NodeJS.Platform): Promise<void> {
  for (const claimPath of await listClaimPaths(lockPath)) {
    let claim: LeaseSnapshot;
    try {
      claim = await inspectLease(claimPath, platform);
    } catch (error) {
      if (error instanceof LeaseMissingError) {
        continue;
      }
      throw error;
    }
    if (claim.record?.nonce === nonce) {
      await removeClaim(claimPath, claim);
    }
  }
}

async function restoreClaim(
  claimPath: string,
  lockPath: string,
  snapshot: LeaseSnapshot,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (isFileError(error, "EEXIST")) {
      return false;
    }
    throw lockFailure("Could not reserve the fixed lease path for restoration.");
  }

  try {
    if (snapshot.contents !== null) {
      await writeOwnerContents(lockPath, snapshot.contents);
    }
    let restored: LeaseSnapshot;
    try {
      restored = await inspectLease(lockPath, platform);
    } catch (error) {
      if (error instanceof LeaseMissingError) {
        let originalClaim: LeaseSnapshot;
        try {
          originalClaim = await inspectLease(claimPath, platform);
        } catch (claimError) {
          if (claimError instanceof LeaseMissingError) {
            return false;
          }
          throw claimError;
        }
        if (originalClaim.contents === snapshot.contents) {
          await removeClaim(claimPath, originalClaim);
          return false;
        }
      }
      throw error;
    }
    if (restored.contents !== snapshot.contents) {
      throw unsafeLock();
    }
    await removeClaim(claimPath, snapshot);
    return true;
  } catch (error) {
    await removeEmptyOrOwnedDirectory(lockPath, snapshot.contents, platform).catch(() => undefined);
    throw error;
  }
}

async function removeClaim(claimPath: string, snapshot: LeaseSnapshot): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(claimPath);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  const expectedEntries = snapshot.contents === null ? [] : [OWNER_FILE];
  if (entries.sort().join(",") !== expectedEntries.join(",")) {
    throw unsafeLock();
  }
  if (snapshot.contents !== null) {
    await unlink(join(claimPath, OWNER_FILE)).catch((error: unknown) => {
      if (!isFileError(error, "ENOENT")) {
        throw error;
      }
    });
  }
  await rmdir(claimPath).catch((error: unknown) => {
    if (!isFileError(error, "ENOENT")) {
      throw error;
    }
  });
}

async function removeEmptyOrOwnedDirectory(
  lockPath: string,
  ownerContents: string | null,
  platform: NodeJS.Platform,
): Promise<void> {
  const entries = await readdir(lockPath);
  if (entries.length === 0) {
    await rmdir(lockPath);
    return;
  }
  if (entries.length === 1 && entries[0] === OWNER_FILE && ownerContents !== null) {
    const actual = await readOwnerContents(join(lockPath, OWNER_FILE), platform);
    if (actual.contents === ownerContents) {
      await unlink(join(lockPath, OWNER_FILE));
      await rmdir(lockPath);
    }
  }
}

async function inspectLease(leasePath: string, platform: NodeJS.Platform): Promise<LeaseSnapshot> {
  const directoryStats = await lstat(leasePath, { bigint: true }).catch((error: unknown) => {
    throw isFileError(error, "ENOENT")
      ? new LeaseMissingError("Credential lease disappeared during validation.")
      : lockFailure("Could not inspect the Mochi credential lease.");
  });
  if (
    directoryStats.isSymbolicLink() ||
    !directoryStats.isDirectory() ||
    (platform !== "win32" &&
      (!isOwnedByCurrentUser(directoryStats.uid) || (Number(directoryStats.mode) & 0o777) !== 0o700))
  ) {
    throw unsafeLock();
  }

  let entries: string[];
  try {
    entries = await readdir(leasePath);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      throw new LeaseMissingError("Credential lease disappeared during validation.");
    }
    throw lockFailure("Could not list the Mochi credential lease.");
  }
  if (entries.length === 0) {
    return {
      contents: null,
      record: null,
      modifiedAt: Number(directoryStats.mtimeMs),
      changedAt: Number(directoryStats.ctimeMs),
      directoryDevice: directoryStats.dev,
      directoryInode: directoryStats.ino,
      ownerDevice: null,
      ownerInode: null,
    };
  }
  if (entries.length !== 1 || entries[0] !== OWNER_FILE) {
    throw unsafeLock();
  }

  const owner = await readOwnerContents(join(leasePath, OWNER_FILE), platform);
  return {
    contents: owner.contents,
    record: parseLeaseRecord(owner.contents),
    modifiedAt: Math.max(Number(directoryStats.mtimeMs), owner.modifiedAt),
    changedAt: Number(directoryStats.ctimeMs),
    directoryDevice: directoryStats.dev,
    directoryInode: directoryStats.ino,
    ownerDevice: owner.device,
    ownerInode: owner.inode,
  };
}

async function readOwnerContents(
  ownerPath: string,
  platform: NodeJS.Platform,
): Promise<{ contents: string; modifiedAt: number; device: bigint; inode: bigint }> {
  let pathStats;
  try {
    pathStats = await lstat(ownerPath, { bigint: true });
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      throw new LeaseMissingError("Credential lease owner disappeared during validation.");
    }
    throw lockFailure("Could not inspect the Mochi credential lease owner.");
  }
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isFile() ||
    (platform !== "win32" && (!isOwnedByCurrentUser(pathStats.uid) || (Number(pathStats.mode) & 0o777) !== 0o600))
  ) {
    throw unsafeLock();
  }

  let handle;
  try {
    handle = await open(ownerPath, constants.O_RDONLY | noFollowFlag());
    const handleStats = await handle.stat({ bigint: true });
    if (
      !handleStats.isFile() ||
      pathStats.dev !== handleStats.dev ||
      pathStats.ino !== handleStats.ino ||
      (platform !== "win32" && (!isOwnedByCurrentUser(handleStats.uid) || (Number(handleStats.mode) & 0o777) !== 0o600))
    ) {
      throw unsafeLock();
    }
    return {
      contents: await handle.readFile("utf8"),
      modifiedAt: Number(handleStats.mtimeMs),
      device: handleStats.dev,
      inode: handleStats.ino,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error instanceof LeaseMissingError || isFileError(error, "ENOENT")) {
      throw new LeaseMissingError("Credential lease owner disappeared during validation.");
    }
    throw lockFailure("Could not read the Mochi credential lease owner.");
  } finally {
    await handle?.close();
  }
}

async function writeOwnerRecord(lockPath: string, record: LeaseRecord): Promise<void> {
  await writeOwnerContents(lockPath, JSON.stringify(record));
}

async function writeOwnerContents(lockPath: string, contents: string): Promise<void> {
  const ownerPath = join(lockPath, OWNER_FILE);
  let handle;
  try {
    handle = await open(ownerPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch {
    throw lockFailure("Could not initialize the Mochi credential lease owner.");
  } finally {
    await handle?.close();
  }
}

function parseLeaseRecord(contents: string): LeaseRecord | null {
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

function isStale(snapshot: LeaseSnapshot, currentTime: number): boolean {
  return currentTime - (snapshot.record?.acquiredAt ?? snapshot.modifiedAt) > STALE_AFTER_MS;
}

function sameLease(left: LeaseSnapshot, right: LeaseSnapshot): boolean {
  return (
    left.directoryDevice === right.directoryDevice &&
    left.directoryInode === right.directoryInode &&
    left.ownerDevice === right.ownerDevice &&
    left.ownerInode === right.ownerInode &&
    left.contents === right.contents
  );
}

async function listClaimPaths(lockPath: string): Promise<string[]> {
  const parent = dirname(lockPath);
  const prefix = `.${basename(lockPath)}.claim.`;
  return (await readdir(parent))
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => join(parent, entry));
}

function uniqueClaimPath(lockPath: string): string {
  return join(dirname(lockPath), `.${basename(lockPath)}.claim.${randomBytes(16).toString("hex")}`);
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
    "Credential leases must contain only a validated owner record in a trusted directory.",
    ExitCode.Local,
  );
}

function lockFailure(message: string): CliError {
  return new CliError("CREDENTIAL_LOCK_FAILED", message, ExitCode.Local);
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
