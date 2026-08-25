import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createFileStore } from "../../src/storage/file-store.js";

const temporaryDirectories: string[] = [];

async function temporaryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mochi-file-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("file credential store", () => {
  test("creates an owner-only directory and atomically stores an owner-only secret", async () => {
    const root = await temporaryPath();
    const configDirectory = join(root, "mochi");
    const credentialsPath = join(configDirectory, "credentials.json");
    const fileStore = createFileStore(credentialsPath);

    await fileStore.set("secret-json");

    expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
    expect(await fileStore.get()).toBe("secret-json");
    expect(await readdir(configDirectory)).toEqual(["credentials.json"]);
  });

  test("rejects a permissive pre-existing config directory instead of changing it", async () => {
    const root = await temporaryPath();
    const configDirectory = join(root, "mochi");
    const credentialsPath = join(configDirectory, "credentials.json");
    await mkdir(configDirectory, { mode: 0o755 });
    const fileStore = createFileStore(credentialsPath);

    await expect(fileStore.set("secret")).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });

    expect((await stat(configDirectory)).mode & 0o777).toBe(0o755);
  });

  test("returns null for an absent credential and delete remains idempotent", async () => {
    const root = await temporaryPath();
    const fileStore = createFileStore(join(root, "mochi", "credentials.json"));

    expect(await fileStore.get()).toBeNull();
    await expect(fileStore.delete()).resolves.toBeUndefined();
  });

  test("rejects a symlinked config directory without writing through it", async () => {
    const root = await temporaryPath();
    const targetDirectory = join(root, "target");
    const configDirectory = join(root, "mochi");
    await mkdir(targetDirectory, { mode: 0o700 });
    await symlink(targetDirectory, configDirectory, "dir");
    const fileStore = createFileStore(join(configDirectory, "credentials.json"));

    await expect(fileStore.set("secret")).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });
    expect(await readdir(targetDirectory)).toEqual([]);
  });

  test("rejects a symlinked credential without reading or overwriting its target", async () => {
    const root = await temporaryPath();
    const configDirectory = join(root, "mochi");
    const targetPath = join(root, "unrelated-secret");
    const credentialsPath = join(configDirectory, "credentials.json");
    await mkdir(configDirectory, { mode: 0o700 });
    await writeFile(targetPath, "unrelated", { mode: 0o600 });
    await symlink(targetPath, credentialsPath);
    const fileStore = createFileStore(credentialsPath);

    await expect(fileStore.get()).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });
    await expect(fileStore.set("replacement")).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });
    expect(await readFile(targetPath, "utf8")).toBe("unrelated");
  });

  test("rejects a non-regular credential path", async () => {
    const root = await temporaryPath();
    const configDirectory = join(root, "mochi");
    const credentialsPath = join(configDirectory, "credentials.json");
    await mkdir(credentialsPath, { recursive: true, mode: 0o700 });
    const fileStore = createFileStore(credentialsPath);

    await expect(fileStore.get()).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });
    await expect(fileStore.set("replacement")).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_UNSAFE" });
  });

  test("tolerates an unsupported Windows directory fsync after the file is durable", async () => {
    const root = await temporaryPath();
    let directorySyncAttempted = false;
    const fileStore = createFileStore(join(root, "mochi", "credentials.json"), {
      platform: "win32",
      directorySync: async () => {
        directorySyncAttempted = true;
        throw Object.assign(new Error("unsupported"), { code: "EINVAL" });
      },
    });

    await fileStore.set("secret-json");

    expect(directorySyncAttempted).toBe(true);
    expect(await fileStore.get()).toBe("secret-json");
  });

  test("does not suppress a directory fsync failure on POSIX", async () => {
    const root = await temporaryPath();
    const fileStore = createFileStore(join(root, "mochi", "credentials.json"), {
      platform: "linux",
      directorySync: async () => {
        throw Object.assign(new Error("unexpected"), { code: "EINVAL" });
      },
    });

    await expect(fileStore.set("secret-json")).rejects.toMatchObject({ code: "CREDENTIAL_STORAGE_FAILED" });
  });
});
