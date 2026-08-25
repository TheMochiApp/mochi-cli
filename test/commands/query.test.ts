import { describe, expect, test } from "vitest";

import { CliError } from "../../src/core/errors.js";
import { parseQueryPairs } from "../../src/commands/query.js";

describe("parseQueryPairs", () => {
  test("encodes pairs deterministically and preserves repeated keys", () => {
    expect(parseQueryPairs(["tag=one", "tag=two", "search=a b", "cursor=a=b"]).toString()).toBe(
      "tag=one&tag=two&search=a+b&cursor=a%3Db",
    );
  });

  test.each([
    "missing-equals",
    "=value",
    "\u0000=value",
    "key=line\nfeed",
    "__proto__=value",
    "constructor=x",
    "prototype=x",
    "toString=x",
  ])("rejects unsafe pair %j", (pair) => {
    expect(() => parseQueryPairs([pair])).toThrow(CliError);
  });

  test("accepts an explicit empty value", () => {
    expect(parseQueryPairs(["search="]).toString()).toBe("search=");
  });
});
