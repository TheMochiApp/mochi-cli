# Mochi API skill evaluation

**Date:** 2026-08-25

**Method:** Compare the original fresh-agent trace with the generated `npx skills use` prompt, all directly routed references, contract tests, and fixture-only discovery checks. No production authentication, customer data, or mutation was used.

## Interactive qualified-lead read

**Baseline:** The agent eventually found read scopes but trusted a stale README query name before OpenAPI and was uncertain about ordering and retries.

**Forward trace:** The skill selects interactive local OAuth, requests only the read scope named by the current guide, reads `/llms.txt`, chooses the lead synchronization guide, validates exact transport details in OpenAPI, checks installed CLI help, and refuses to request or display credentials. If the live sources are unavailable, it stops instead of using remembered parameters.

**Result: PASS**

## Weekly unattended metrics

**Baseline:** The agent correctly rejected interactive login on a fresh CI runner but lacked a direct auth decision and reliable date, unit, and retry discovery.

**Forward trace:** The skill selects an organization-scoped API key from a server-side secret manager, requests only scopes used by the report, reads the business metrics guide, verifies date and unit semantics in the current guide/OpenAPI, and follows the current failure guidance. It does not run browser OAuth in CI or place the key in agent context.

**Result: PASS**

## Lead, tag, automation, and send request

**Baseline:** The agent noticed the CLI was read-only but lacked a stable boundary for writes, idempotency, partial failure, activation, and outbound-message approval.

**Forward trace:** The skill refuses to invent a write CLI command. It reads the safe lead-update and bounded-automation guides, then produces a direct-API plan naming minimum scope, role floor, prior state, idempotency, partial-failure stop conditions, explicit approval, verification, and rollback. It treats automation activation, a flow run, and any outbound message as separately approved effects.

**Result: PASS**

## Regression boundary

The evaluation passes because the skill routes decisions to current sources, not because it contains copied API details. Contract tests reject paths, transport identifiers, payload examples, query examples, credential shapes, write-oriented CLI commands, and volatile retry values in the skill tree.
