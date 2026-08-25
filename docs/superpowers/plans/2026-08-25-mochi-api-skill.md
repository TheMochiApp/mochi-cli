# Mochi API Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one installable, high-level `mochi-api` skill that teaches agents to select authentication, discover current Git-backed documentation/OpenAPI, respect the read-only CLI boundary, and plan direct API integrations safely without copying volatile API details.

**Architecture:** The skill lives under `skills/mochi-api/` in the public CLI repository but remains outside the npm package allowlist. `SKILL.md` is a small router to three stable references. Repository tests reject endpoint/catalog drift, credential examples, unsupported write CLI guidance, and packaging changes. A scheduled read-only workflow verifies the canonical documentation discovery surface; E2 cannot merge until that live check passes.

**Tech Stack:** Agent Skills Markdown/YAML, Node.js 20, TypeScript/Vitest, Prettier, the `skills` CLI, Python skill-creator validation, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-mochi-api-skill-and-agent-docs-design.md`

## Constraints

- Skill path is exactly `skills/mochi-api/SKILL.md`; do not add a root `SKILL.md`.
- The install command is exactly `npx skills add TheMochiApp/mochi-cli --skill mochi-api`.
- The skill links to `https://docs.themochi.app/llms.txt` and routes task details through current guides and OpenAPI.
- Do not copy endpoint paths, operation IDs, payload fields, query parameters, response schemas, rate-limit values, or status retry tables into the skill.
- Stable CLI guidance is limited to auth routing, `mochi --help`, and the fact that Phase D commands are read-only.
- Never accept, request, print, or demonstrate a real credential.
- Existing MCP users keep the existing MCP connection and are never asked to export or exchange its token.
- A mutation plan must name scope, role floor, idempotency, partial failure, explicit approval, and verification before execution.
- Outbound messages, automation activation, and flow runs require explicit user intent.
- The skill changes only when the auth matrix, discovery entry point, CLI credential/read-write boundary, or stable security invariant changes.
- Do not add skill files to the npm `files` allowlist or publish the package.
- Do not merge E2 until E1 is merged and `https://docs.themochi.app/llms.txt` passes the live discovery smoke test.

## Task 1: Add RED skill contract tests

**Files:**

- Create: `test/skill/contract.test.ts`
- Create: `test/skill/behavior-contract.test.ts`

- [ ] Write failing tests requiring `SKILL.md`, `agents/openai.yaml`, and exactly three direct references: `authentication.md`, `docs-discovery.md`, and `integration-safety.md`.
- [ ] Require frontmatter name `mochi-api`, a trigger-focused description, no root `SKILL.md`, and interface metadata whose default prompt explicitly invokes `$mochi-api`.
- [ ] Require the four authentication journeys, canonical `/llms.txt` discovery order, `/llms-full.txt` broad-research fallback, OpenAPI verification, installed CLI help, and stop-on-drift behavior.
- [ ] Require the read-only CLI boundary, no credential handling, existing MCP preservation, minimum scopes, bounded mutation planning, and explicit approval for sends/activation/runs.
- [ ] Reject `/v1/` paths, operation-ID patterns, JSON payload examples, query-parameter examples, bearer/JWT/key samples, copied retry values, write-oriented `mochi` commands, and legacy `TheMochiApp/mochi-agent` text anywhere below `skills/mochi-api/`.
- [ ] Require every reference to be linked directly from `SKILL.md` and prohibit reference-to-reference links.
- [ ] Run `npm test -- test/skill` and confirm failure because the skill does not exist.
- [ ] Commit the RED tests: `test: define maintainable Mochi API skill contract`.

## Task 2: Scaffold and write the high-level skill

**Files:**

- Create: `skills/mochi-api/SKILL.md`
- Create: `skills/mochi-api/agents/openai.yaml`
- Create: `skills/mochi-api/references/authentication.md`
- Create: `skills/mochi-api/references/docs-discovery.md`
- Create: `skills/mochi-api/references/integration-safety.md`

- [ ] Scaffold with the repository-independent skill creator:

  ```bash
  python3 /Users/maximossapranidis/.codex/skills/.system/skill-creator/scripts/init_skill.py \
    mochi-api --path skills --resources references \
    --interface display_name='Mochi API' \
    --interface short_description='Connect agents and integrations to Mochi safely.' \
    --interface default_prompt='Use $mochi-api to choose authentication, read current Mochi docs, and complete this integration safely.'
  ```

- [ ] Replace the generated entrypoint with a concise router: choose workload/auth, read one direct reference, follow `/llms.txt` → task guide → OpenAPI → installed CLI help, enforce credential/read-only boundaries, and finish with a structured verification report.
- [ ] In `authentication.md`, explain interactive OAuth CLI, unattended API key, existing MCP, and registered OAuth application journeys. Cover minimum scopes, browser consent, revocation, secret-manager/keychain boundaries, and the prohibition against exposing a credential.
- [ ] In `docs-discovery.md`, use the exact canonical discovery URL, explain smallest-guide selection and broad-research fallback, inspect OpenAPI for exact HTTP details, inspect CLI help for installed commands, and stop/report when sources are unavailable or contradictory.
- [ ] In `integration-safety.md`, keep the CLI read-only; require a bounded direct-API write plan with scope, role floor, idempotency, partial-failure handling, explicit approval, verification, and rollback. Require separate approval for outbound messages, activation, and flow runs.
- [ ] Generate `agents/openai.yaml` through the skill-creator generator and verify `allow_implicit_invocation: true` remains the default.
- [ ] Run the contract tests and make them pass without adding API details.
- [ ] Run Prettier on the skill and tests.
- [ ] Commit: `feat: add high-level Mochi API skill`.

## Task 3: Validate packaging and local installation

**Files:**

- Create: `scripts/verify-skill.mjs`
- Create: `test/skill/install.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] Add failing tests for deterministic skill-tree validation, exactly-one-skill discovery from the repository root, and absence of `skills/` from `npm pack --dry-run --json` output.
- [ ] Implement `scripts/verify-skill.mjs` to validate frontmatter, required files, direct-reference resolution, no placeholders, no forbidden API/catalog content, and no root skill. It must produce deterministic sanitized errors and never access the network.
- [ ] Add `verify:skill` to `package.json` and include it in `ci` before the build.
- [ ] Add CI steps that run `npm run verify:skill`, the official Agent Skills reference validator pinned to commit `69ef37e9424c0a7ea9dd2293b559e43ec8176379`, and a clean temporary `npx skills add "$GITHUB_WORKSPACE" --skill mochi-api --agent codex --copy --yes` installation. Install the validator with `pip install 'git+https://github.com/agentskills/agentskills.git@69ef37e9424c0a7ea9dd2293b559e43ec8176379#subdirectory=skills-ref'`, then run `skills-ref validate skills/mochi-api`. Verify exactly one installed directory named `mochi-api`.
- [ ] Keep the npm package allowlist unchanged and prove the tarball contains only the CLI artifacts already intended for publication.
- [ ] Run the skill validator, install test, package policy test, and full CLI CI.
- [ ] Commit: `test: validate Mochi API skill packaging`.

## Task 4: Add live discovery monitoring without production credentials

**Files:**

- Create: `.github/workflows/skill-live-docs.yml`
- Create: `scripts/check-live-docs.mjs`
- Create: `test/skill/live-docs.test.ts`

- [ ] Write fixture-based tests for parsing `/llms.txt`, resolving only same-origin HTTPS guide links, requiring all six E1 guide slugs, and confirming mutual discovery of the published OpenAPI artifact.
- [ ] Implement a read-only checker with strict timeouts, response-size limits, redirect validation, and no authentication. It must never call customer-data endpoints.
- [ ] Add a weekly and manual workflow. Do not run the live check on ordinary pushes while the domain is not configured.
- [ ] Make the workflow report unreachable guides or contract discovery drift, with no secrets or write permissions.
- [ ] Run fixture tests locally. Before E2 is eligible to merge, run the manual workflow and require success against `https://docs.themochi.app/llms.txt`.
- [ ] Commit: `ci: monitor Mochi agent documentation discovery`.

## Task 5: Record maintenance and behavioral evidence

**Files:**

- Modify: `README.md`
- Create: `docs/skill-maintenance.md`
- Create: `docs/evaluations/2026-08-25-mochi-api-skill.md`

- [ ] Document installation from `TheMochiApp/mochi-cli`, the canonical docs origin, the skill-versus-CLI distinction, and the fact that npm publication and production OAuth remain separate rollout actions.
- [ ] Record the maintenance rule: ordinary endpoint/schema/example/rate-limit changes update backend docs/OpenAPI only; skill edits are reserved for the four stable contracts in the design.
- [ ] Forward-evaluate the same three baseline journeys: interactive qualified-lead read, weekly unattended metrics, and lead/tag/automation/send planning.
- [ ] Require the evaluation to select OAuth plus minimum read scopes for interactive use, API key for CI, existing MCP preservation, current guide/OpenAPI inspection, no invented write CLI, bounded writes, and no credentials in prompts/output.
- [ ] Record failures honestly and fix only the smallest stable guidance needed; do not make the skill pass by copying endpoints.
- [ ] Commit: `docs: explain skill maintenance and evaluation`.

## Final verification and draft PR

- [ ] Run `npm run ci`.
- [ ] Run `npm run verify:skill` and the skill-creator quick validator.
- [ ] Run a clean temporary local install and prove exactly `mochi-api` is discovered.
- [ ] Run `npm pack --dry-run --json` and prove skill files remain outside the npm tarball.
- [ ] Run `git diff --check`, inspect the complete branch diff, and confirm there are no secrets or copied API details.
- [ ] Push `codex/phase-e-agent-skill` and open an E2 draft PR against `main`.
- [ ] State in the PR body that it changes no backend/runtime route, feature flag, OAuth grant, MCP connection, npm publication, or production configuration.
- [ ] Keep the PR draft/blocked until E1 is merged, `docs.themochi.app` has valid DNS/TLS, `/llms.txt` links the merged guides, the manual live check is green, and review/CI approve the skill.
