import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { CliError, ExitCode } from "../core/errors.js";
import type { SecretStore } from "./types.js";

const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set(["EINVAL", "ENOTSUP", "EPERM", "EISDIR"]);

export interface FileStoreOptions {
  platform?: NodeJS.Platform;
  directorySync?: (directory: string) => Promise<void>;
}

export function createFileStore(filePath: string, options: FileStoreOptions = {}): SecretStore {
  const directory = dirname(filePath);
  const platform = options.platform ?? process.platform;
  const directorySync = options.directorySync ?? syncDirectory;

  return {
    async get(): Promise<string | null> {
      try {
        if (!(await validateExistingOwnerOnlyDirectory(directory))) {
          return null;
        }
        return await readOwnerOnlyRegularFile(filePath);
      } catch (error) {
        throw storageFailure(error);
      }
    },

    async set(value: string): Promise<void> {
      await ensureOwnerOnlyDirectory(directory);
      const temporaryPath = join(directory, `.${basename(filePath)}.${randomBytes(16).toString("hex")}.tmp`);
      let temporaryCreated = false;

      try {
        await validateExistingOwnerOnlyRegularFile(filePath);
        const handle = await open(temporaryPath, "wx", 0o600);
        temporaryCreated = true;
        try {
          await handle.writeFile(value, "utf8");
          await handle.chmod(0o600);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, filePath);
        temporaryCreated = false;
        await syncDirectoryForPlatform(directory, platform, directorySync);
      } catch (error) {
        if (temporaryCreated) {
          await unlink(temporaryPath).catch(() => undefined);
        }
        throw storageFailure(error);
      }
    },

    async delete(): Promise<void> {
      try {
        if (!(await validateExistingOwnerOnlyDirectory(directory))) {
          return;
        }
        const existing = await validateExistingOwnerOnlyRegularFile(filePath);
        if (!existing) {
          return;
        }

        const claimedPath = join(directory, `.${basename(filePath)}.${randomBytes(16).toString("hex")}.delete`);
        await rename(filePath, claimedPath);
        try {
          await validateExistingOwnerOnlyRegularFile(claimedPath);
          await unlink(claimedPath);
        } catch (error) {
          await restoreClaimedFile(claimedPath, filePath);
          throw error;
        }
        await syncDirectoryForPlatform(directory, platform, directorySync);
      } catch (error) {
        if (!isFileError(error, "ENOENT")) {
          throw storageFailure(error);
        }
      }
    },
  };
}

export async function ensureOwnerOnlyDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw storageFailure(error);
  }

  const stats = await safeLstat(directory);
  if (!stats?.isDirectory() || stats.isSymbolicLink() || !isOwnedByCurrentUser(stats)) {
    throw unsafeStorage();
  }
  if ((Number(stats.mode) & 0o777) !== 0o700) {
    throw unsafeStorage();
  }
}

async function validateExistingOwnerOnlyDirectory(directory: string): Promise<boolean> {
  const stats = await safeLstat(directory);
  if (!stats) {
    return false;
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !isOwnedByCurrentUser(stats) ||
    (Number(stats.mode) & 0o777) !== 0o700
  ) {
    throw unsafeStorage();
  }
  return true;
}

async function readOwnerOnlyRegularFile(filePath: string): Promise<string | null> {
  const pathStats = await safeLstat(filePath);
  if (!pathStats) {
    return null;
  }
  validateOwnerOnlyRegularStats(pathStats);

  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return null;
    }
    if (isFileError(error, "ELOOP")) {
      throw unsafeStorage();
    }
    throw error;
  }

  try {
    const stats = await handle.stat();
    validateOwnerOnlyRegularStats(stats);
    if (!sameFile(pathStats, stats)) {
      throw unsafeStorage();
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function validateExistingOwnerOnlyRegularFile(filePath: string): Promise<boolean> {
  const pathStats = await safeLstat(filePath);
  if (!pathStats) {
    return false;
  }
  validateOwnerOnlyRegularStats(pathStats);

  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return false;
    }
    if (isFileError(error, "ELOOP")) {
      throw unsafeStorage();
    }
    throw error;
  }

  try {
    const handleStats = await handle.stat();
    validateOwnerOnlyRegularStats(handleStats);
    if (!sameFile(pathStats, handleStats)) {
      throw unsafeStorage();
    }
    return true;
  } finally {
    await handle.close();
  }
}

function validateOwnerOnlyRegularStats(stats: Awaited<ReturnType<typeof lstat>>): void {
  if (!stats.isFile() || !isOwnedByCurrentUser(stats) || (Number(stats.mode) & 0o777) !== 0o600) {
    throw unsafeStorage();
  }
}

async function safeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return null;
    }
    throw storageFailure(error);
  }
}

async function restoreClaimedFile(claimedPath: string, destinationPath: string): Promise<void> {
  const destination = await safeLstat(destinationPath);
  if (destination) {
    throw unsafeStorage();
  }
  await rename(claimedPath, destinationPath);
}

async function syncDirectoryForPlatform(
  directory: string,
  platform: NodeJS.Platform,
  directorySync: (directory: string) => Promise<void>,
): Promise<void> {
  try {
    await directorySync(directory);
  } catch (error) {
    if (platform === "win32" && isFileErrorWithAllowedCode(error, WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS)) {
      return;
    }
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function noFollowFlag(): number {
  return "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
}

function isOwnedByCurrentUser(stats: Awaited<ReturnType<typeof lstat>>): boolean {
  return typeof process.getuid !== "function" || Number(stats.uid) === process.getuid();
}

function sameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return Number(left.dev) === Number(right.dev) && Number(left.ino) === Number(right.ino);
}

function unsafeStorage(): CliError {
  return new CliError(
    "CREDENTIAL_STORAGE_UNSAFE",
    "Credential storage must use owner-only regular files in an owner-only directory.",
    ExitCode.Local,
  );
}

function storageFailure(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  return new CliError("CREDENTIAL_STORAGE_FAILED", "Secure credential storage failed.", ExitCode.Local);
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isFileErrorWithAllowedCode(error: unknown, allowedCodes: ReadonlySet<string>): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    allowedCodes.has(error.code)
  );
}
