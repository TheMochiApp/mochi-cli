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

  test("requires the authoritative backend Developers gate before frontend activation", async () => {
    const readme = await readFile(README_URL, "utf8");

    expect(readme).toContain(
      "the final reviewed merge result of [backend PR #1798](https://github.com/TheMochiApp/mochi-backend/pull/1798) is deployed",
    );
    expect(readme).toContain("`PUBLIC_API_DEVELOPERS_ENABLED=true`");
    expect(readme).toContain("`PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS`");
    expect(readme).toContain("`VITE_PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS`");
    expect(readme).toContain("Backend authorization is authoritative; frontend visibility is not authorization.");
    expect(readme).toContain("The Developers and OAuth cohorts are independent");
    expect(readme).toContain("Both backend organization cohorts and the frontend Developers cohort default empty");
  });

  test("records the active controlled pilot and independent rollback boundaries", async () => {
    const readme = await readFile(README_URL, "utf8");

    expect(readme).toContain("Production is now a controlled exact-organization pilot");
    expect(readme).toContain("this public repository deliberately does not duplicate the changing customer cohort");
    expect(readme).toContain("`PUBLIC_API_OAUTH_ENABLED=true`");
    expect(readme).toContain("`PUBLIC_API_DEVELOPERS_ENABLED=true`");
    expect(readme).toContain("OAuth remains limited to the seven read-only scopes");
    expect(readme).toContain("separately authorized to create read/write API keys");
    expect(readme).toContain("`PUBLIC_API_FLOWS_ENABLED=false`");
    expect(readme).toContain("P5 enforcement remains independently controlled");
    expect(readme).toContain("For a Developers-only rollback, set `PUBLIC_API_DEVELOPERS_ENABLED=false` first");
    expect(readme).toContain("For an OAuth-only rollback, set `PUBLIC_API_OAUTH_ENABLED=false`");
    expect(readme).toContain("Revoke any affected API keys separately");
    expect(readme).not.toContain("Production OAuth remains off");
    expect(readme).not.toContain("Production OAuth must remain off");
    expect(readme).not.toContain("single-organization pilot");
    expect(readme).not.toContain("is the sole entry");
  });
});
