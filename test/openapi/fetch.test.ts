import { lstat, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { RuntimeConfig } from "../../src/core/config.js";
import { CliError } from "../../src/core/errors.js";
import { fetchOpenApi, writeOpenApi } from "../../src/openapi/fetch.js";

const config: RuntimeConfig = {
  apiBaseUrl: "https://api.themochi.app",
  issuerUrl: "https://api.themochi.app",
  openapiUrl: "https://docs.example/openapi.json",
};

const validDocument = {
  openapi: "3.0.3",
  info: { version: "1.0.0" },
  paths: {},
};

describe("fetchOpenApi", () => {
  test("fetches without credentials and with bounded transport options", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(validDocument));
    });

    await expect(fetchOpenApi(config, fetch)).resolves.toEqual(validDocument);
    expect(fetch).toHaveBeenCalledWith(config.openapiUrl, expect.any(Object));
  });

  test("enforces the two MiB limit while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const fetch = vi.fn(async () => new Response(body));

    await expect(fetchOpenApi(config, fetch)).rejects.toMatchObject({ code: "OPENAPI_TOO_LARGE" });
  });

  test.each([
    ["missing openapi", { info: { version: "1" }, paths: {} }],
    ["blank openapi", { openapi: " ", info: { version: "1" }, paths: {} }],
    ["missing version", { openapi: "3.0.3", info: {}, paths: {} }],
    ["blank version", { openapi: "3.0.3", info: { version: " " }, paths: {} }],
    ["array paths", { openapi: "3.0.3", info: { version: "1" }, paths: [] }],
  ])("rejects a structurally invalid document: %s", async (_case, body) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
    await expect(fetchOpenApi(config, fetch)).rejects.toMatchObject({ code: "OPENAPI_INVALID" });
  });

  test("sanitizes network and response errors", async () => {
    const secret = "sensitive-document-value";
    const failed = vi.fn(async () => new Response(secret, { status: 500 }));
    const rejected = vi.fn(async () => {
      throw new Error(secret);
    });

    for (const fetch of [failed, rejected]) {
      try {
        await fetchOpenApi(config, fetch);
        throw new Error("expected fetch to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });
});

describe("writeOpenApi", () => {
  test("atomically writes the validated document beside the destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-openapi-"));
    const output = join(directory, "openapi.json");

    await writeOpenApi(validDocument, output);

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(validDocument);
    expect((await lstat(output)).isFile()).toBe(true);
    expect(await readdir(directory)).toEqual(["openapi.json"]);
  });

  test("does not overwrite a symbolic link", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-openapi-"));
    const protectedFile = join(directory, "protected.json");
    const output = join(directory, "openapi.json");
    await writeFile(protectedFile, "protected", "utf8");
    await symlink(protectedFile, output);

    await expect(writeOpenApi(validDocument, output)).rejects.toMatchObject({ code: "OPENAPI_OUTPUT_UNSAFE" });
    expect(await readFile(protectedFile, "utf8")).toBe("protected");
  });

  test("rejects a directory destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-openapi-"));
    await expect(writeOpenApi(validDocument, directory)).rejects.toMatchObject({ code: "OPENAPI_OUTPUT_UNSAFE" });
  });

  test("sanitizes invalid filesystem paths", async () => {
    const unsafePath = `private-value-${String.fromCharCode(0)}.json`;
    try {
      await writeOpenApi(validDocument, unsafePath);
      throw new Error("expected write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as Error).message).not.toContain("private-value");
    }
  });
});
