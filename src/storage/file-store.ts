import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { CliError, ExitCode } from "../core/errors.js";
import type { SecretStore } from "./types.js";

export function createFileStore(filePath: string): SecretStore {
  const directory = dirname(filePath);

  return {
    async get(): Promise<string | null> {
      try {
        await chmod(directory, 0o700);
        await chmod(filePath, 0o600);
        return await readFile(filePath, "utf8");
      } catch (error) {
        if (isFileError(error, "ENOENT")) {
          return null;
        }
        throw storageFailure(error);
      }
    },

    async set(value: string): Promise<void> {
      await ensureOwnerOnlyDirectory(directory);
      const temporaryPath = join(directory, `.${basename(filePath)}.${randomBytes(16).toString("hex")}.tmp`);
      let temporaryCreated = false;

      try {
        const handle = await open(temporaryPath, "wx", 0o600);
        temporaryCreated = true;
        try {
          await handle.writeFile(value, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, filePath);
        temporaryCreated = false;
        await chmod(filePath, 0o600);
        await syncDirectory(directory);
      } catch (error) {
        if (temporaryCreated) {
          await unlink(temporaryPath).catch(() => undefined);
        }
        throw storageFailure(error);
      }
    },

    async delete(): Promise<void> {
      try {
        await unlink(filePath);
        await syncDirectory(directory);
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
    await chmod(directory, 0o700);
  } catch (error) {
    throw storageFailure(error);
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

function storageFailure(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  return new CliError("CREDENTIAL_STORAGE_FAILED", "Secure credential storage failed.", ExitCode.Local);
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
