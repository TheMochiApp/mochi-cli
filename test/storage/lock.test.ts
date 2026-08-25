import { mkdir, mkdtemp, readFile, rename, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { CliError } from "../../src/core/errors.js";
import { withCredentialLock } from "../../src/storage/lock.js";

const temporaryDirectories: string[] = [];

async function lockPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mochi-lock-"));
  temporaryDirectories.push(directory);
  return join(directory, "mochi", "credentials.lock");
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("credential lock", () => {
  test("serializes two contenders and creates an owner-only lock", async () => {
    const path = await lockPath();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: (() => void) | undefined;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = withCredentialLock(
      path,
      async () => {
        events.push("first-start");
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        firstStarted?.();
        await firstMayFinish;
        events.push("first-finish");
      },
      { sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)) },
    );
    await firstDidStart;
    const second = withCredentialLock(
      path,
      async () => {
        events.push("second-start");
      },
      { sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toEqual(["first-start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-finish", "second-start"]);
  });

  test("removes a lock only when its stored timestamp is older than sixty seconds", async () => {
    const path = await lockPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ nonce: "stale-owner", acquiredAt: 9_999 }), { mode: 0o600 });
    let now = 70_000;

    const result = await withCredentialLock(path, async () => "acquired", {
      now: () => now,
      nonce: () => "new-owner",
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    expect(result).toBe("acquired");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not remove a replacement lock it no longer owns", async () => {
    const path = await lockPath();

    await withCredentialLock(
      path,
      async () => {
        await writeFile(path, JSON.stringify({ nonce: "replacement", acquiredAt: 1 }), { mode: 0o600 });
      },
      { nonce: () => "original", now: () => 1 },
    );

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ nonce: "replacement", acquiredAt: 1 });
  });

  test("fails after the ten-second acquisition deadline without removing a live lock", async () => {
    const path = await lockPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ nonce: "live-owner", acquiredAt: 0 }), { mode: 0o600 });
    let now = 0;

    const failure = await withCredentialLock(path, async () => undefined, {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CliError);
    expect(failure).toMatchObject({ code: "CREDENTIAL_LOCK_TIMEOUT" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ nonce: "live-owner", acquiredAt: 0 });
  });

  test("reaps an empty crash-created lock only after its trusted file age exceeds sixty seconds", async () => {
    const path = await lockPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, "", { mode: 0o600 });
    await utimes(path, 0, 0);
    let now = 70_000;

    const result = await withCredentialLock(path, async () => "recovered", {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    expect(result).toBe("recovered");
  });

  test("preserves a fresh malformed lock through the acquisition deadline", async () => {
    const path = await lockPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, "", { mode: 0o600 });
    let now = Date.now();

    await expect(
      withCredentialLock(path, async () => undefined, {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_TIMEOUT" });
    expect(await readFile(path, "utf8")).toBe("");
  });

  test("atomically claims its lock before cleanup and cannot unlink a replacement pathname", async () => {
    const path = await lockPath();
    const replacement = { nonce: "replacement", acquiredAt: 2 };
    let replacementInstalled = false;

    await withCredentialLock(path, async () => undefined, {
      nonce: () => "original",
      now: () => 1,
      renameFile: async (source, destination) => {
        await rename(source, destination);
        if (destination === `${path}.claim` && !replacementInstalled) {
          replacementInstalled = true;
          await writeFile(path, JSON.stringify(replacement), { mode: 0o600 });
        }
      },
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
  });

  test("records the actual successful acquisition time after contention", async () => {
    const path = await lockPath();
    const times = [100, 250];

    await withCredentialLock(
      path,
      async () => {
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ nonce: "owner", acquiredAt: 250 });
      },
      {
        nonce: () => "owner",
        now: () => times.shift() ?? 250,
      },
    );
  });

  test("rejects a symlinked lock without changing its target", async () => {
    const path = await lockPath();
    const target = join(dirname(path), "unrelated");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(target, JSON.stringify({ nonce: "target", acquiredAt: 0 }), { mode: 0o600 });
    await symlink(target, path);
    let now = 1;

    await expect(
      withCredentialLock(path, async () => undefined, {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_UNSAFE" });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ nonce: "target", acquiredAt: 0 });
  });
});
