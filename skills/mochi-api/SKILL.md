---
name: mochi-api
description: Use when connecting an agent or integration to Mochi, choosing interactive OAuth, an unattended API key, an existing MCP connection, or a registered OAuth application, discovering current Public API docs and OpenAPI, using the read-only CLI, or planning safe direct API writes.
---

# Mochi API

Use current Mochi sources and keep credentials outside agent context. This skill is a router, not an API reference.

## Start with the workload

1. Identify whether the work is interactive local, unattended, already connected through MCP, or a registered browser application.
2. Read [authentication guidance](references/authentication.md) and choose the least-privilege path before suggesting commands.
3. Never request, read, paste, print, log, or store a credential. Never ask a user to place one in a prompt.

## Discover the current contract

1. Read [documentation discovery](references/docs-discovery.md).
2. Open `https://docs.themochi.app/llms.txt` and select the smallest relevant task guide.
3. Read that guide for intent, authorization, ordering, and safety behavior.
4. Inspect the current OpenAPI reference for exact paths, parameters, payloads, and response schemas.
5. If using the CLI, inspect `mochi --help` and command help for the installed read-only surface.

If the current docs or OpenAPI cannot be reached, or if they disagree, stop and report the unverified source or drift. Do not construct a request from memory.

## Choose the execution boundary

- For a first interactive local read, use the guided path in the authentication reference after verifying current docs and installed CLI help.
- Use the CLI only for supported authentication and read operations.
- For direct API integration or any mutation, read [integration safety](references/integration-safety.md), produce the bounded plan it requires, and obtain explicit approval before execution.
- Keep an existing MCP connection intact. Do not export, exchange, or convert its credential.
- Treat outbound messages, automation activation, and flow runs as separately approved effects.

## Complete the task

Report the authentication mode, organization, minimum scopes, current guide and OpenAPI source, operation performed or proposed, sanitized result, and verification outcome. For a failure, include only safe request metadata and the current documented recovery action—never a credential or customer payload.
