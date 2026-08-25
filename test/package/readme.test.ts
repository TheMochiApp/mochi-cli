import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const README_URL = new URL("../../README.md", import.meta.url);

describe("README command examples", () => {
  test("uses the live leads-list pagination and stage query names", async () => {
    const readme = await readFile(README_URL, "utf8");

    expect(readme).toContain("mochi leads list --query page_size=25 --query stage=QUALIFIED");
    expect(readme).toContain("mochi signals list --query page_size=25");
    expect(readme).toContain("mochi bookings list --query page_size=25");
    expect(readme).toContain("mochi connections list");
    expect(readme).toContain("mochi api get '/v1/leads/?page_size=10'");
    expect(readme).not.toContain("mochi leads list --query limit=25 --query status=qualified");
    expect(readme).not.toMatch(/(?:signals|bookings|connections) list --query limit=/u);
    expect(readme).not.toContain("mochi api get '/v1/leads/?limit=10'");
  });
});
