# Mochi API Skill and Agent-First Documentation Design

**Status:** Approved

**Date:** 2026-08-25

**Product source:** `mochi-backend/prd/2026-08-24-mochi-public-api-ai-agent-access.md`

**Depends on:** Phase D `mochi-cli` merged as `TheMochiApp/mochi-cli#1`

## Decision

Phase E ships one installable `mochi-api` skill from the public
`TheMochiApp/mochi-cli` repository and a separate set of intent-based task
guides from the Git-backed Public API documentation in `mochi-backend`.

The skill teaches agents how to choose an authentication mode, discover and
read the current documentation, verify the live contract, operate the
read-only CLI, and build integrations safely. It does not copy the endpoint
catalog, accept credentials, or imply that the CLI supports writes. The
generated OpenAPI artifact and Git-backed documentation remain canonical.

Delivery is split into two reviewable PRs, with documentation first:

1. **E1 — Agent-first task guides:** `mochi-backend` documentation, examples,
   canonical-domain runbook, CI drift checks, and PRD progress updates.
2. **E2 — Installable skill:** `mochi-cli` skill content, validation, install
   smoke tests, contract-drift tests, and behavioral evaluation.

Neither PR enables production OAuth, publishes the npm package, changes an API
route, or alters a production setting.

## Goals

- Let an existing customer connect an interactive AI agent with one browser
  approval and no token copying.
- Make the correct choice between interactive OAuth, unattended API keys, and
  the existing MCP connection obvious to an agent.
- Teach agents to find the relevant current task guide, request minimum scopes,
  and verify the live contract before constructing requests.
- Provide safe guidance for read workflows and integration design without
  inventing unsupported CLI commands.
- Organize public documentation by customer intent and include useful cURL,
  Python, Node.js/TypeScript, and PHP examples.
- Detect drift between the skill, CLI command registry, documentation, scopes,
  and generated OpenAPI artifact before merge.

## Non-goals

- Adding write commands to the Phase D CLI.
- Publishing `@themochiapp/cli` to npm.
- Enabling `PUBLIC_API_ENABLED` or `PUBLIC_API_OAUTH_ENABLED`.
- Reusing, exporting, or exchanging an existing MCP or Zapier token.
- Providing a hosted token broker, device authorization flow, SDK generator,
  agent runtime, or MCP server.
- Duplicating the complete OpenAPI schema or endpoint reference in skill files.
- Replacing the internal product-knowledge sync implemented by
  `mochi-backend#1767`.

## Authentication decision contract

The skill routes by workload before giving commands:

| Workload                                | Authentication                                           | Credential boundary                                                                   |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Interactive local agent or developer    | `mochi auth login` using OAuth authorization code + PKCE | CLI stores credentials in the OS keychain; the agent never reads or prints tokens     |
| Unattended server, scheduled job, or CI | Organization-scoped API key with minimum scopes          | Operator creates the key; workload reads it from a server-side secret manager         |
| Existing Mochi MCP connection           | Continue using the existing MCP connection               | MCP credential remains bound to MCP and is never converted to a Public API credential |
| Third-party browser application         | Registered OAuth client using authorization code + PKCE  | Application owns its redirect and refresh lifecycle; it does not scrape CLI storage   |

Reusing the customer's signed-in browser session avoids another password login,
but it does not skip consent. A new Public API grant still names the
organization, resource, and scopes.

## Canonical sources and discovery

The following ownership rules prevent documentation drift:

- The generated Public API OpenAPI artifact is the machine-readable contract.
- `mochi-backend/docs/public-api/` is the human-documentation source and
  GitBook is its published presentation.
- `https://docs.themochi.app` is the canonical public documentation origin.
  E1 records the target and exact operator runbook; E2 cannot merge until the
  custom domain is configured and `https://docs.themochi.app/llms.txt` resolves
  successfully.
- GitBook's `/llms.txt` and `/llms-full.txt` outputs are discovery surfaces,
  not separately edited sources.
- `mochi-cli/src/commands/registry.ts` is the source for CLI convenience
  commands and their required scopes.
- `mochi-cli/README.md` owns CLI installation and operator-facing command
  examples.
- The skill links to these sources and contains only stable routing, safety,
  and workflow guidance.

An agent using the skill follows this discovery order:

1. Read the canonical `/llms.txt` index and select the smallest relevant task
   guide.
2. Read that task guide for intent, authentication, scopes, sequencing, and
   safety behavior.
3. Validate and inspect the live OpenAPI document for exact paths, parameters,
   payloads, and response schemas.
4. Use `mochi --help` or command help for the installed CLI surface instead of
   relying on commands copied into the skill.

`/llms-full.txt` is a fallback for broad research, not the default input for a
single task. If the current docs or OpenAPI document cannot be reached, the
agent reports that it cannot safely verify the request; it does not fall back
to remembered endpoint details. If the published contract and a prose example
disagree, the agent stops and reports the drift rather than guessing.

## E2 — Installable `mochi-api` skill

### Repository layout

```text
skills/
└── mochi-api/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
    └── references/
        ├── authentication.md
        ├── docs-discovery.md
        └── integration-safety.md
```

There is no root-level `SKILL.md`. The skill stays at
`skills/mochi-api/SKILL.md` so standard Agent Skills discovery can find it
without a shallow root skill shadowing nested skills.

Installation uses the canonical repository and explicit skill name:

```bash
npx skills add TheMochiApp/mochi-cli --skill mochi-api
```

### Entrypoint

`SKILL.md` is a concise router rather than a manual. It contains:

- frontmatter name `mochi-api` and a trigger-only description;
- the authentication-mode decision table;
- the docs-index → task-guide → OpenAPI discovery sequence;
- the read-only CLI boundary;
- credential and prompt-safety invariants;
- links to one focused reference for the active task; and
- a compact completion contract: execute, inspect the structured result,
  handle documented errors, and report what changed or was read.

The entrypoint and its references contain no endpoint catalog, operation-ID
catalog, payload schema, query-parameter list, or multi-language request
collection. Those belong in the current published docs and OpenAPI artifact.

`agents/openai.yaml` supplies only interface metadata: display name, short
description, and a default prompt that explicitly invokes `$mochi-api`.
Automatic discovery remains enabled. It declares no MCP dependency because
the skill supports CLI, API-key, OAuth-application, and MCP journeys rather
than requiring one tool.

### Focused references

`authentication.md` covers the four authentication journeys, minimum-scope
selection, browser consent, key storage boundaries, revocation, and the rule
against requesting or displaying credentials.

`docs-discovery.md` teaches the discovery sequence: use `/llms.txt` to locate a
task guide, use the guide to understand intent and constraints, inspect OpenAPI
for exact HTTP details, and inspect installed CLI help for current convenience
commands. It explains when the larger `/llms-full.txt` index is appropriate and
how to report unavailable or contradictory sources.

`integration-safety.md` covers building direct API integrations. It explains
that the Phase D CLI is read-only, routes unattended jobs to API keys, and
requires agents to inspect published schemas before proposing writes. A
multi-step write plan must specify required scopes, role floor, idempotency,
partial-failure handling, and verification before execution. Outbound messages
or automation activation require explicit user intent and cannot be inferred
from a general request to “integrate Mochi.”

Detailed status-code and retry rules remain in the published error, rate-limit,
and idempotency guides. The skill keeps only two stable safety invariants: an
authentication or authorization failure is not solved by exposing a token, and
a mutation is never retried unless the current documentation explicitly
defines its idempotency behavior.

## E1 — Agent-first public documentation

The backend documentation adds or reshapes six task guides in this order:

1. Connect an AI agent.
2. Build a lead synchronization integration.
3. Enrich or update a lead safely.
4. Read analytics, revenue, and bookings.
5. Build a bounded automation.
6. Diagnose authentication, scope, rate-limit, and idempotency failures.

Each guide contains the same contract:

- customer goal and safe preconditions;
- recommended authentication mode;
- exact scopes and role floor;
- operation sequence and expected state transitions;
- cURL, Python, Node.js/TypeScript, and PHP examples when raw HTTP is useful;
- representative response and error envelopes;
- retry and idempotency behavior;
- verification and rollback steps for writes; and
- data that must not enter logs, prompts, screenshots, or source control.

Endpoint-level schemas remain generated from OpenAPI. Task guides link to the
generated operation rather than copying complete request or response schemas.

The E1 PR also changes the install command in the AI-Agent Access PRD from
`TheMochiApp/mochi-agent` to `TheMochiApp/mochi-cli`, records the merged Phase C
and D PRs, marks the E1 documentation slice with its actual PR state, and keeps
E2 pending until its own PR exists.

## Baseline failures the skill must correct

A fresh agent given the repository without the Phase E skill was evaluated on
three representative journeys:

1. **Interactive qualified-lead read:** it eventually found the correct read
   scopes but had to inspect deeply, trusted stale README query names before
   checking OpenAPI, and remained unsure about retry and ordering semantics.
2. **Weekly CI metrics:** it correctly rejected interactive CLI OAuth for a
   fresh CI runner, but the authentication choice, timezone/date semantics,
   revenue units, and retry rules were not discoverable enough.
3. **Lead/tag/automation/send request:** it correctly noticed the CLI was
   read-only, but lacked a stable contract for write planning, idempotency,
   partial writes, automation activation, and outbound-message approval.

The minimal skill must make these decisions direct and consistent. It must not
solve the gaps by embedding a second API reference.

## Maintenance model

The documentation changes frequently; the skill should not.

Routine endpoint additions, operation-ID changes, scope corrections, payload
changes, query parameters, examples, rate-limit values, and error details are
made only in `mochi-backend` documentation or its generated OpenAPI artifact.
Agents receive those changes the next time they follow the discovery sequence,
without a new skill release.

The skill changes only when one of its stable contracts changes:

- the authentication-mode decision matrix;
- the canonical documentation discovery entry point;
- the CLI's read/write or credential-handling boundary; or
- a cross-cutting security invariant for agent operation.

CI enforces this separation. Skill files are rejected if they accumulate API
paths, operation IDs, payload properties, or query-parameter examples. A
scheduled read-only smoke check verifies that
`https://docs.themochi.app/llms.txt`, its referenced task guides, and the
OpenAPI artifact remain reachable and mutually discoverable.
The smoke check reports drift but never authenticates or calls customer data.

## Verification design

### Structural and packaging checks

- Validate Agent Skills frontmatter, folder naming, references, and scaffold
  completeness with the official Agent Skills validator. The local
  `quick_validate.py` check is an additional development check, not a CI-only
  dependency on a developer machine.
- Reject a root-level `SKILL.md`, unresolved placeholders, nested reference
  chains, credential examples, and copied bearer tokens.
- Run a clean temporary install through the supported `skills` CLI and verify
  that exactly `mochi-api` is discovered.
- Ensure the npm tarball remains unchanged; skill files are repository content
  and are not silently added to `@themochiapp/cli` publication unless a later
  release decision explicitly changes the package allowlist.

### Contract-drift checks

- Verify any stable CLI capability names mentioned by the skill against the
  command registry; exact commands are discovered through current CLI help.
- Validate operation IDs, scopes, examples, and schemas in the task guides
  against the checked-in generated artifact or CI fixture, not against copied
  skill content.
- Reject legacy install commands containing `TheMochiApp/mochi-agent`.
- Reject skill files containing endpoint paths, copied operation IDs, payload
  examples, query-parameter examples, bearer tokens, or write-oriented `mochi`
  commands.

### Behavioral evaluation

Run the same three fresh-agent scenarios used for the baseline with the skill
available. Passing behavior requires:

- selecting OAuth and minimum read scopes for an interactive local journey;
- selecting an API key, not browser CLI login, for unattended CI;
- preserving the existing MCP connection instead of asking for token export;
- reading the relevant current guide and validating live parameters before
  constructing commands;
- refusing to invent write CLI commands;
- producing a bounded write plan before any mutation; and
- never requesting, printing, logging, or placing a credential in a prompt.

Evaluations use fixtures or read-only discovery and never authenticate against
production, create a grant, or mutate customer data.

## Rollout and production safety

E1 and E2 are documentation/tooling dark deploys. Merge alone does not make the
CLI installable from npm and does not make Public API OAuth available to a
customer. Phase F remains responsible for named canaries and production flags.

The safe merge order is:

1. Merge E1 after OpenAPI/doc drift checks and rendered GitBook review pass.
2. Configure the GitBook custom domain and confirm GitBook publishes from Git
   at `https://docs.themochi.app`, including current LLM discovery files.
3. Merge E2 after skill validation, behavioral evaluation, the public discovery
   smoke check, and Linux/Windows CI are green.
4. Leave OAuth/API production flags unchanged until the Phase F canary.

Rollback is repository-level: revert the skill or documentation commit. No
database rollback, application rollback, credential revocation, or production
configuration change is required for Phase E itself.

## Alternatives considered

### Put the skill in `mochi-backend`

Rejected. It couples installation to a large private application repository,
makes discovery noisy, and mixes customer tooling with Django runtime code.

### Create a separate `mochi-skills` repository

Deferred. One skill does not justify another repository, release policy, and
ownership surface. `mochi-cli` is already the trusted public entry point.

### Copy all API documentation into the skill

Rejected. It improves offline completeness briefly but guarantees schema,
scope, and example drift. Progressive disclosure plus canonical live sources
is smaller and safer.

## Acceptance criteria

Phase E is complete when:

- `npx skills add TheMochiApp/mochi-cli --skill mochi-api` discovers and
  installs exactly one valid skill;
- an agent can choose the correct authentication journey without asking for a
  credential;
- interactive read workflows use the merged CLI and verified live contract;
- unattended examples use scoped API keys from a secret manager;
- existing MCP users are not asked to reconnect or export tokens;
- agents do not invent write CLI commands or execute ambiguous multi-step
  writes;
- routine API and documentation changes reach agents without requiring a skill
  edit;
- all six intent-based guides exist with the required language and safety
  coverage;
- CI detects command, scope, operation-ID, install-command, and example drift;
  and
- merging Phase E changes no production API behavior or configuration.
