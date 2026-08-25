# Public API Agent-First Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Git-backed, intent-based Mochi Public API guides at the canonical `https://docs.themochi.app` origin so agents read current documentation and OpenAPI instead of copied API details.

**Architecture:** This E1 backend slice adds six task guides plus a typed metadata validator. Guide frontmatter declares authentication modes, scopes, OpenAPI operation IDs, referenced parameters, and whether raw HTTP examples are present. CI checks the declarations against the checked-in generated OpenAPI artifact and GitBook navigation. The later `mochi-api` skill remains a small router to these live sources.

**Tech Stack:** Python 3.13, PyYAML, pytest, GitBook Markdown, OpenAPI 3.0.3, Ruff, mypy.

**Spec:** `mochi-cli/docs/superpowers/specs/2026-08-25-mochi-api-skill-and-agent-docs-design.md`

## Constraints

- Work in an isolated backend worktree created from current `origin/master`.
- Treat `docs/public-api-v1-openapi.json` and its generator as the endpoint contract.
- Edit Git-backed source only; do not edit GitBook pages through its UI.
- Use `https://docs.themochi.app` as the canonical origin and `/llms.txt` as the default agent entry point. Reserve `/llms-full.txt` for broad research.
- Keep endpoint details in backend docs and OpenAPI, not in the future skill.
- Every guide with `raw_http: true` contains Bash/cURL, Python, TypeScript, and PHP examples.
- Never place real secrets, customer data, or production credentials in examples or tests.
- Mutation examples use a caller-generated UUID4 idempotency key and preserve it on retries.
- Do not change Django routes, settings, flags, database schema, MCP, Zapier, or message-send behavior.
- Implement each task test-first and commit after its focused checks pass.

## Task 1: Add a typed task-guide contract validator

**Files:**

- Create: `mochi/public_api/docs_contract.py`
- Create: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Write failing parser tests using temporary Markdown fixtures with YAML frontmatter. Cover accepted authentication modes (`oauth-cli`, `api-key`, `oauth-app`, `mcp`), operation IDs, scopes, parameter names, `raw_http`, and detected language fences.
- [ ] Write failing validation tests for an unknown operation, stale parameter, scope mismatch, unsupported auth mode, a raw-HTTP guide missing one required language, and credential-shaped examples.
- [ ] Add frozen typed records `OperationUse`, `GuideContract`, and `OpenApiOperation`. Avoid `Any`; narrow decoded YAML and JSON values through explicit helper functions.
- [ ] Implement `parse_guide_contract(path: Path) -> GuideContract`. Require one frontmatter document and reject malformed or missing fields with path-aware messages.
- [ ] Implement `index_openapi_operations(document: object) -> dict[str, OpenApiOperation]`. Index each operation by `operationId`, collect `x-mochi-required-scope`, and combine path-level plus operation-level parameter names.
- [ ] Implement `validate_guide_contract(contract, operations) -> list[str]`. Return deterministic diagnostics rather than raising on the first drift.
- [ ] Detect fenced languages case-insensitively and normalize aliases so `bash`/`shell`, `python`, `typescript`/`ts`, and `php` satisfy the four-language requirement.
- [ ] Reject obvious credential examples such as literal bearer/JWT/API-key values while allowing placeholders such as `$MOCHI_API_KEY` and `YOUR_API_KEY`.
- [ ] Run focused tests in the isolated Docker stack:

      docker compose up -d db
          docker compose run --rm django pytest mochi/public_api/tests/test_agent_docs_contract.py -q

- [ ] Run formatting, lint, and type checks for the new files:

      docker compose run --rm django ruff format --check mochi/public_api/docs_contract.py mochi/public_api/tests/test_agent_docs_contract.py
          docker compose run --rm django ruff check mochi/public_api/docs_contract.py mochi/public_api/tests/test_agent_docs_contract.py
          docker compose run --rm django mypy mochi/public_api/docs_contract.py

- [ ] Commit: `test(public-api): add agent guide contract validator`

## Task 2: Declare the canonical docs origin and discovery contract

**Files:**

- Modify: `docs/public-api/README.md`
- Modify: `docs/public-api/production-rollout-runbook.md`
- Modify: `mochi/public_api/tests/test_gitbook_openapi_workflow.py`

- [ ] Add failing assertions that the README and runbook name `https://docs.themochi.app`, that both identify `/llms.txt` as the default agent entry point, and that the README describes `/llms-full.txt` as a broad-research fallback.
- [ ] Add a concise “For AI agents” section to the README with the exact discovery order: `/llms.txt` → smallest relevant guide → OpenAPI → installed CLI help. State that unavailable or contradictory sources must be reported rather than guessed around.
- [ ] Document that `docs/public-api/` is the editable source, GitBook is the renderer, and GitBook UI edits are not canonical.
- [ ] Expand the rollout runbook with operator steps for GitBook custom-domain configuration, DNS verification, TLS readiness, HTTP 200 checks for the root and `/llms.txt`, guide-link verification, and rollback to the previous GitBook domain without a Django deployment.
- [ ] Keep domain activation explicitly outside this code PR and leave every production feature flag unchanged.
- [ ] Run:

      docker compose run --rm django pytest mochi/public_api/tests/test_gitbook_openapi_workflow.py -q

- [ ] Commit: `docs(public-api): define canonical agent discovery`

## Task 3: Add the “Connect an AI agent” guide

**Files:**

- Create: `docs/public-api/connect-ai-agent.md`
- Modify: `docs/public-api/authentication.md`
- Modify: `docs/public-api/SUMMARY.md`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Add a failing test requiring the guide in `SUMMARY.md`, requiring all four authentication modes in frontmatter, and rejecting the legacy `TheMochiApp/mochi-agent` install string.
- [ ] Give the guide metadata with all four auth modes, empty scopes/operations, and `raw_http: false`.
- [ ] Route interactive local agents to `mochi auth login`; route CI, scheduled jobs, and servers to scoped API keys; preserve an existing MCP connection; route third-party browser apps to authorization code plus PKCE.
- [ ] Explain that an existing browser session avoids another password entry but does not skip organization/scope consent and does not convert an MCP token into a Public API token.
- [ ] State that the merged CLI is read-only, stores OAuth credentials in the OS keychain, and must never print or expose tokens to an agent.
- [ ] Use the canonical install repository and keep npm publication availability accurate; do not imply the package is published before the release phase.
- [ ] Update authentication docs to link to this decision guide without duplicating its full matrix.
- [ ] Run the contract and GitBook workflow tests.
- [ ] Commit: `docs(public-api): add AI agent connection guide`

## Task 4: Add lead synchronization and safe-update guides

**Files:**

- Create: `docs/public-api/lead-synchronization.md`
- Create: `docs/public-api/update-lead-safely.md`
- Modify: `docs/public-api/SUMMARY.md`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Add failing contract tests for both guides and their navigation entries.
- [ ] Declare lead synchronization operations `get_public_leads_list` and `get_public_lead_detail`, scope `leads:read`, and referenced list parameters `updated_since`, `cursor`, and `page_size`.
- [ ] Explain an initial cursor walk, incremental UTC checkpointing, opaque cursor handling, duplicate-safe upserts, advancing the checkpoint only after durable page storage, and bounded retry of documented read failures.
- [ ] Supply equivalent cURL, Python, TypeScript, and PHP examples for the incremental list operation. Link to OpenAPI for the complete response shape.
- [ ] Declare safe-update operations `patch_public_lead_detail`, `patch_public_lead_contact`, `post_public_lead_tags`, and `delete_public_lead_tag_detail` with scope `leads:write`.
- [ ] Structure the write guide as read → plan → explicit confirmation → idempotent mutation → verification. Explain manual-tag restrictions, partial-failure handling, and rollback/compensating action.
- [ ] Supply four-language examples for one representative lead update using the same caller-owned UUID4 idempotency key on retry.
- [ ] Run focused guide-contract tests.
- [ ] Commit: `docs(public-api): add lead integration task guides`

## Task 5: Add the business metrics guide

**Files:**

- Create: `docs/public-api/read-business-metrics.md`
- Modify: `docs/public-api/SUMMARY.md`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Add failing tests for navigation and metadata.
- [ ] Declare `get_public_analytics_funnel`, `get_public_revenue_summary`, and `get_public_bookings_list` with scopes `analytics:read`, `revenue:read`, and `bookings:read`.
- [ ] Document the revenue role floor as Creator, Manager, or Finance; tell unattended workloads to use a minimum-scope API key rather than browser CLI OAuth.
- [ ] Explain UTC/date boundaries by pointing to each operation schema, preserve returned currency and units, and paginate rather than assuming one page is complete.
- [ ] Add cURL, Python, TypeScript, and PHP examples for a representative revenue-summary read.
- [ ] Run focused contract tests.
- [ ] Commit: `docs(public-api): add business metrics task guide`

## Task 6: Add the bounded automation guide

**Files:**

- Create: `docs/public-api/build-bounded-automation.md`
- Modify: `docs/public-api/SUMMARY.md`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Add failing tests for navigation and metadata.
- [ ] Declare `post_public_keyword_automation_create`, `post_public_flow_list`, and `post_public_flow_run_create` with scope `automations:write`.
- [ ] Document Creator/Manager role requirements and feature availability checks.
- [ ] Require explicit user approval before activating an automation or starting a flow run. A general request to integrate Mochi is not outbound-action approval.
- [ ] Require caller-owned idempotency, verification, and a bounded partial-failure plan. Keep default examples inactive or test-only.
- [ ] Add four-language examples for creating an inactive keyword automation, based on the checked-in OpenAPI schema rather than invented fields.
- [ ] Run focused contract tests.
- [ ] Commit: `docs(public-api): add bounded automation task guide`

## Task 7: Add the failure-diagnosis guide

**Files:**

- Create: `docs/public-api/diagnose-api-failures.md`
- Modify: `docs/public-api/errors.md`
- Modify: `docs/public-api/rate-limits.md`
- Modify: `docs/public-api/idempotency.md`
- Modify: `docs/public-api/SUMMARY.md`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`

- [ ] Add a failing test requiring the guide, all auth modes, empty operations/scopes, and `raw_http: false`.
- [ ] Cover 401, 403, 404, 409, 429, network failures, and 5xx responses with a diagnostic decision sequence.
- [ ] Require capture of `X-Request-ID` and sanitized context; prohibit placing tokens, API keys, customer payloads, or sensitive response bodies in prompts, logs, screenshots, or tickets.
- [ ] Cross-link the detailed error, rate-limit, and idempotency pages instead of copying volatile retry numbers into this high-level guide.
- [ ] Clarify that authentication or authorization failures are never solved by exposing credentials and that mutations are retried only when current docs define safe idempotency behavior.
- [ ] Add reciprocal links from the detailed pages.
- [ ] Run focused contract tests.
- [ ] Commit: `docs(public-api): add API failure diagnosis guide`

## Task 8: Enforce repository-wide drift and record progress

**Files:**

- Modify: `mochi/public_api/docs_contract.py`
- Modify: `mochi/public_api/tests/test_agent_docs_contract.py`
- Modify: `prd/2026-08-24-mochi-public-api-ai-agent-access.md`
- Modify: `docs/public-api/production-rollout-runbook.md`

- [ ] Add a failing repository-level test for `validate_agent_docs_tree(repository_root: Path) -> list[str]`.
- [ ] Require exactly these intent guides: `connect-ai-agent.md`, `lead-synchronization.md`, `update-lead-safely.md`, `read-business-metrics.md`, `build-bounded-automation.md`, and `diagnose-api-failures.md`.
- [ ] Validate each guide against `docs/public-api-v1-openapi.json`, require each guide exactly once in `SUMMARY.md`, and reject unknown agent-guide files, legacy install commands, unresolved placeholders, or credential-shaped examples.
- [ ] Query GitHub read-only for the exact merged Phase C and D PR numbers and merge states before editing the PRD; do not guess from memory.
- [ ] Push the branch and open the E1 pull request so its actual number exists.
- [ ] Update the PRD with the canonical `TheMochiApp/mochi-cli --skill mochi-api` install command, exact merged Phase C/D evidence, the actual E1 PR number and open state, and E2 still pending.
- [ ] Add go-live checks for the custom domain, `/llms.txt`, every intent-guide link, and the OpenAPI artifact. State that E2 remains blocked until public discovery succeeds.
- [ ] Commit and push the progress update: `docs(prd): record Phase E1 agent docs progress`.

## Final verification and PR handoff

- [ ] Run the complete documentation and OpenAPI suite:

      docker compose run --rm django pytest \
            mochi/public_api/tests/test_agent_docs_contract.py \
            mochi/public_api/tests/test_openapi_contract.py \
            mochi/public_api/tests/test_gitbook_openapi_workflow.py -q

- [ ] Verify the generated artifact has no drift:

      docker compose run --rm django python manage.py generate_public_api_openapi --check

- [ ] Run formatting, lint, and type checking on every changed Python file.
- [ ] Inspect `git diff --check`, the full branch diff, and `git status --short`.
- [ ] Render or preview every GitBook page and verify navigation, code fences, links, and no secret-shaped content.
- [ ] Push all commits and mark the E1 pull request ready for review.
- [ ] In the PR body state: documentation/tests only; no route, setting, migration, feature flag, OAuth grant, or production behavior change; custom-domain activation is an operator step; E2 is blocked until `/llms.txt` is live; rollback is a docs revert.
- [ ] Record exact verification commands and outcomes in the PR body.

## E2 handoff

Write the separate `mochi-api` skill implementation plan only after E1 fixes the published guide names and discovery structure. That plan must point at the actual merged E1 URLs, run the three baseline scenarios forward with the skill installed, and preserve the rule that frequently changing endpoint details remain outside the skill.
