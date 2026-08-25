import { describe, expect, test, vi } from "vitest";

import { CliError, ExitCode } from "../../src/core/errors.js";
import { failureJson, successJson, writeResult } from "../../src/core/output.js";

describe("process output", () => {
  test("wraps successful data in the stable JSON envelope", () => {
    expect(successJson({ authenticated: true })).toEqual({
      ok: true,
      data: { authenticated: true },
    });
  });

  test("redacts CliError implementation details from a failure envelope", () => {
    const error = new CliError("AUTH_REQUIRED", "Run mochi auth login.", ExitCode.Authentication, {
      refreshToken: "secret",
    });
    error.stack = "secret stack";

    expect(failureJson(error)).toEqual({
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "Run mochi auth login." },
    });
  });

  test("writes one newline-terminated JSON result and sets the exit code", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;

    try {
      writeResult(successJson({ authenticated: true }), ExitCode.Success);

      expect(write).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith('{"ok":true,"data":{"authenticated":true}}\n');
      expect(process.exitCode).toBe(ExitCode.Success);
    } finally {
      process.exitCode = previousExitCode;
      write.mockRestore();
    }
  });

  test("redacts nested Error instances before writing a result", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    const error = new CliError("AUTH_REQUIRED", "Run mochi auth login.", ExitCode.Authentication, {
      refreshToken: "super-secret-refresh-token",
    });
    error.stack = "super-secret-stack";

    try {
      writeResult(successJson({ nestedError: error }), ExitCode.Authentication);

      expect(write).toHaveBeenCalledWith('{"ok":true,"data":{"nestedError":"[error]"}}\n');
      const stdout = String(write.mock.calls[0]?.[0]);
      expect(stdout).not.toContain("super-secret-refresh-token");
      expect(stdout).not.toContain("super-secret-stack");
      expect(stdout).not.toContain("details");
      expect(stdout).not.toContain("exitCode");
    } finally {
      process.exitCode = previousExitCode;
      write.mockRestore();
    }
  });
});
