# Mochi API skill maintenance

The `mochi-api` skill is a stable router to current Git-backed documentation. It is not another API reference.

## Ownership

| Source                        | Owns                                                                          | Update cadence                                  |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| Backend generated OpenAPI     | Exact operations, paths, parameters, payloads, response schemas, and scopes   | Whenever the API contract changes               |
| Backend Public API guides     | Customer intent, examples, sequencing, error handling, and task safety        | Whenever product behavior or guidance changes   |
| CLI command registry and help | Installed read-only convenience commands and their scopes                     | Whenever the CLI surface changes                |
| `skills/mochi-api/`           | Stable auth routing, source discovery, CLI boundary, and cross-cutting safety | Only when one of those stable contracts changes |

Routine API changes do not require a skill release. Agents pick them up the next time they read `/llms.txt`, the selected task guide, and OpenAPI.

## When to change the skill

Change the skill only when at least one stable contract changes:

- the authentication-mode decision matrix;
- the canonical documentation discovery entry point;
- the CLI credential or read/write boundary; or
- a cross-cutting security invariant for agent operation.

Do not edit the skill for a new endpoint, renamed transport field, query option, example, response shape, scope correction, error detail, or rate-limit value. Make that change in backend docs/OpenAPI and let the repository drift tests protect the published contract.

## Review checklist

1. Confirm the change belongs in the skill rather than current docs/OpenAPI.
2. Run the skill contract and behavioral tests.
3. Run the repository validator and the pinned Agent Skills reference validator.
4. Perform a clean temporary install and confirm exactly `mochi-api` is discovered.
5. Re-run the three baseline journeys and compare the decisions, not just prose.
6. Confirm the npm tarball still excludes `skills/`.
7. Confirm the live discovery check can reach `/llms.txt`, every task guide, and OpenAPI without credentials.
8. Record whether the auth matrix, discovery URL, CLI boundary, or security invariant changed.

Merging a skill change must not publish npm, enable a production flag, create or revoke an OAuth grant, reconnect MCP, or call customer data.

## Automated maintenance

- `CI` runs on every pull request and every push to `main`. It validates the portable Agent Skills structure, deterministic repository policy, behavioral guardrails, a clean local install, formatting, lint, types, tests, build output, production dependencies, and package contents on Linux and Windows.
- `Mochi skill live docs` runs daily and can be dispatched manually. It installs `mochi-api` from the public GitHub repository, then checks the public `/llms.txt` index, every task guide, and the canonical OpenAPI artifact without credentials.
- `Live OpenAPI contract` runs daily and validates the published OpenAPI document against the CLI command registry.
- The npm publish workflow repeats the repository and live-contract gates before building the release artifact. Publishing the CLI is independent from distributing the skill.

The skill is distributed directly from public GitHub `main`; it does not need an npm release or a separate hosting deployment. Skills.sh indexing and its security rescans are operated by Skills.sh, so this repository cannot force their timing. A security-sensitive skill change is complete only after repository CI passes and the external audit page reflects the new GitHub revision.
