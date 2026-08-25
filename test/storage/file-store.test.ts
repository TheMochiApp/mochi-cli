import { chmod, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
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

  test("repairs permissive modes before replacing an existing credential", async () => {
    const root = await temporaryPath();
    const configDirectory = join(root, "mochi");
    const credentialsPath = join(configDirectory, "credentials.json");
    const fileStore = createFileStore(credentialsPath);
    await fileStore.set("first");
    await chmod(configDirectory, 0o755);
    await chmod(credentialsPath, 0o644);

    await fileStore.set("second");

    expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(credentialsPath, "utf8")).toBe("second");
  });

  test("returns null for an absent credential and delete remains idempotent", async () => {
    const root = await temporaryPath();
    const fileStore = createFileStore(join(root, "mochi", "credentials.json"));

    expect(await fileStore.get()).toBeNull();
    await expect(fileStore.delete()).resolves.toBeUndefined();
  });
});
