import { mkdir, mkdtemp, readFile, readdir, rename, rmdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { withCredentialLock } from "../../src/storage/lock.js";

const temporaryDirectories: string[] = [];
const posixTest = process.platform === "win32" ? test.skip : test;

async function leasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mochi-lock-"));
  temporaryDirectories.push(directory);
  return join(directory, "mochi", "credentials.lock");
}

async function createLease(
  path: string,
  owner: { nonce: string; acquiredAt: number } | string | null,
  options: { directoryMode?: number; ownerMode?: number; modifiedAt?: number } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: options.directoryMode ?? 0o700 });
  await mkdir(path, { mode: options.directoryMode ?? 0o700 });
  if (owner !== null) {
    await writeFile(join(path, "owner"), typeof owner === "string" ? owner : JSON.stringify(owner), {
      mode: options.ownerMode ?? 0o600,
    });
  }
  if (options.modifiedAt !== undefined) {
    if (owner !== null) {
      await utimes(join(path, "owner"), options.modifiedAt / 1000, options.modifiedAt / 1000);
    }
    await utimes(path, options.modifiedAt / 1000, options.modifiedAt / 1000);
  }
}

async function readOwner(path: string): Promise<{ nonce: string; acquiredAt: number }> {
  return JSON.parse(await readFile(join(path, "owner"), "utf8"));
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("credential directory lease", () => {
  test("serializes two contenders", async () => {
    const path = await leasePath();
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
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  posixTest("creates an owner-only directory and owner record", async () => {
    const path = await leasePath();

    await withCredentialLock(path, async () => {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      expect((await stat(join(path, "owner"))).mode & 0o777).toBe(0o600);
    });
  });

  test("a live waiter never claims or resurrects a lease released after its preliminary snapshot", async () => {
    const path = await leasePath();
    let releaseOwner: (() => void) | undefined;
    const ownerMayFinish = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    let ownerStarted: (() => void) | undefined;
    const ownerDidStart = new Promise<void>((resolve) => {
      ownerStarted = resolve;
    });
    let inspectionReached: (() => void) | undefined;
    const waiterInspected = new Promise<void>((resolve) => {
      inspectionReached = resolve;
    });
    let resumeInspection: (() => void) | undefined;
    const inspectionMayResume = new Promise<void>((resolve) => {
      resumeInspection = resolve;
    });
    let paused = false;
    let waiterEntries = 0;

    const owner = withCredentialLock(path, async () => {
      ownerStarted?.();
      await ownerMayFinish;
    });
    await ownerDidStart;
    const waiter = withCredentialLock(
      path,
      async () => {
        waiterEntries += 1;
      },
      {
        sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
        afterPreliminaryInspectionForTests: async () => {
          if (!paused) {
            paused = true;
            inspectionReached?.();
            await inspectionMayResume;
          }
        },
      },
    );

    const observedInspection = await Promise.race([
      waiterInspected.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    if (!observedInspection) {
      releaseOwner?.();
      resumeInspection?.();
      await Promise.allSettled([owner, waiter]);
    }
    expect(observedInspection).toBe(true);

    releaseOwner?.();
    await owner;
    resumeInspection?.();
    await waiter;

    expect(waiterEntries).toBe(1);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(dirname(path))).filter((entry) => entry.includes(".claim."))).toEqual([]);
  });

  test("removes a valid lease only when its timestamp is older than sixty seconds", async () => {
    const path = await leasePath();
    await createLease(path, { nonce: "stale-owner", acquiredAt: 9_999 });
    let now = 70_000;

    const result = await withCredentialLock(path, async () => "acquired", {
      now: () => now,
      nonce: () => "new-owner",
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    expect(result).toBe("acquired");
  });

  test("recovers an old empty directory left by a crash", async () => {
    const path = await leasePath();
    await createLease(path, null, { modifiedAt: 0 });
    let now = 70_000;

    const result = await withCredentialLock(path, async () => "recovered", {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    expect(result).toBe("recovered");
  });

  test("recovers an old malformed owner record left by a crash", async () => {
    const path = await leasePath();
    await createLease(path, "not-json", { modifiedAt: 0 });
    let now = 70_000;

    const result = await withCredentialLock(path, async () => "recovered", {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    expect(result).toBe("recovered");
  });

  test("preserves a fresh empty crash directory through the deadline", async () => {
    const path = await leasePath();
    await createLease(path, null);
    let now = Date.now();

    await expect(
      withCredentialLock(path, async () => undefined, {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_TIMEOUT" });
    expect(await readdir(path)).toEqual([]);
  });

  test("never removes a non-empty lease containing unrecognized entries", async () => {
    const path = await leasePath();
    await createLease(path, { nonce: "do-not-delete", acquiredAt: 0 }, { modifiedAt: 0 });
    await writeFile(join(path, "unexpected"), "preserve", { mode: 0o600 });

    await expect(withCredentialLock(path, async () => undefined, { now: () => 70_000 })).rejects.toMatchObject({
      code: "CREDENTIAL_LOCK_UNSAFE",
    });
    expect((await readdir(path)).sort()).toEqual(["owner", "unexpected"]);
    expect((await readdir(dirname(path))).filter((entry) => entry.includes(".credentials.lock.claim."))).toEqual([]);
  });

  test("release removes only its unique claim when a replacement wins the fixed path", async () => {
    const path = await leasePath();
    const replacement = { nonce: "replacement", acquiredAt: 2 };
    let replacementInstalled = false;

    await withCredentialLock(path, async () => undefined, {
      nonce: () => "original",
      now: () => 1,
      renameFile: async (source, destination) => {
        await rename(source, destination);
        if (source === path && destination.includes(".claim.") && !replacementInstalled) {
          replacementInstalled = true;
          await createLease(path, replacement);
        }
      },
    });

    expect(await readOwner(path)).toEqual(replacement);
  });

  test("stale cleanup never removes a fully initialized replacement lease", async () => {
    const path = await leasePath();
    await createLease(path, { nonce: "stale", acquiredAt: 0 }, { modifiedAt: 0 });
    const replacement = { nonce: "replacement", acquiredAt: 70_000 };
    let replacementInstalled = false;
    let now = 70_000;

    await expect(
      withCredentialLock(path, async () => undefined, {
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        renameFile: async (source, destination) => {
          await rename(source, destination);
          if (source === path && destination.includes(".claim.") && !replacementInstalled) {
            replacementInstalled = true;
            await createLease(path, replacement);
          }
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_TIMEOUT" });
    expect(await readOwner(path)).toEqual(replacement);
  });

  test("records acquisition time after the atomic directory mkdir succeeds", async () => {
    const path = await leasePath();
    const times = [100, 250];

    await withCredentialLock(
      path,
      async () => {
        expect(await readOwner(path)).toEqual({ nonce: "owner", acquiredAt: 250 });
      },
      {
        nonce: () => "owner",
        now: () => times.shift() ?? 250,
      },
    );
  });

  test("acquires under injected Windows ACL semantics without exact POSIX directory bits", async () => {
    const path = await leasePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });

    const result = await withCredentialLock(path, async () => "acquired", {
      platform: "win32",
      now: () => 1,
    });

    expect(result).toBe("acquired");
  });

  test("retries a transient Windows sharing violation while claiming a lease for release", async () => {
    const path = await leasePath();
    let renameAttempts = 0;

    await withCredentialLock(path, async () => undefined, {
      platform: "win32",
      renameFile: async (source, destination) => {
        renameAttempts += 1;
        if (renameAttempts === 1) {
          throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
        }
        await rename(source, destination);
      },
      sleep: async () => undefined,
    });

    expect(renameAttempts).toBe(2);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("bounds repeated Windows sharing-violation retries", async () => {
    const path = await leasePath();
    let renameAttempts = 0;

    await expect(
      withCredentialLock(path, async () => undefined, {
        platform: "win32",
        renameFile: async () => {
          renameAttempts += 1;
          throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
        },
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_FAILED" });

    expect(renameAttempts).toBe(21);
  });

  posixTest("does not retry a POSIX lease-rename failure", async () => {
    const path = await leasePath();
    let renameAttempts = 0;

    await expect(
      withCredentialLock(path, async () => undefined, {
        platform: "linux",
        renameFile: async () => {
          renameAttempts += 1;
          throw Object.assign(new Error("permission denied"), { code: "EPERM" });
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_FAILED" });

    expect(renameAttempts).toBe(1);
  });

  test("retries a transient Windows delete-pending directory during release", async () => {
    const path = await leasePath();
    let removalAttempts = 0;

    await withCredentialLock(path, async () => undefined, {
      platform: "win32",
      removeDirectory: async (directoryPath) => {
        removalAttempts += 1;
        if (removalAttempts === 1) {
          throw Object.assign(new Error("delete pending"), { code: "ENOTEMPTY" });
        }
        await rmdir(directoryPath);
      },
      sleep: async () => undefined,
    });

    expect(removalAttempts).toBe(2);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("bounds repeated Windows delete-pending retries", async () => {
    const path = await leasePath();
    let removalAttempts = 0;

    await expect(
      withCredentialLock(path, async () => undefined, {
        platform: "win32",
        removeDirectory: async () => {
          removalAttempts += 1;
          throw Object.assign(new Error("still delete pending"), { code: "ENOTEMPTY" });
        },
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "ENOTEMPTY" });

    expect(removalAttempts).toBe(21);
  });

  posixTest("does not retry a POSIX non-empty directory removal", async () => {
    const path = await leasePath();
    let removalAttempts = 0;

    await expect(
      withCredentialLock(path, async () => undefined, {
        platform: "linux",
        removeDirectory: async () => {
          removalAttempts += 1;
          throw Object.assign(new Error("not transient on POSIX"), { code: "ENOTEMPTY" });
        },
      }),
    ).rejects.toMatchObject({ code: "ENOTEMPTY" });

    expect(removalAttempts).toBe(1);
  });

  test("rejects a symlinked lease directory without touching its target", async () => {
    const path = await leasePath();
    const target = join(dirname(path), "unrelated");
    await createLease(target, { nonce: "target", acquiredAt: 0 });
    await symlink(target, path, "dir");

    await expect(withCredentialLock(path, async () => undefined)).rejects.toMatchObject({
      code: "CREDENTIAL_LOCK_UNSAFE",
    });
    expect(await readOwner(target)).toEqual({ nonce: "target", acquiredAt: 0 });
  });
});
