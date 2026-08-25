# Mochi Agent CLI Design

**Status:** Approved by the AI-Agent Access PRD and Phase D continuation

**Date:** 2026-08-25

**Product source:** `mochi-backend/prd/2026-08-24-mochi-public-api-ai-agent-access.md`

## Goal

Ship a small, agent-friendly `mochi` CLI that lets an existing Mochi customer
authorize read-only Public API access in their browser without copying a token
into a prompt, terminal command, configuration file, or hosted broker.

## Scope

Phase D includes:

- `mochi auth login`, `auth status`, and `auth logout`;
- OAuth authorization-code flow with S256 PKCE and RFC 7591 dynamic client
  registration;
- reuse of the existing signed-in Mochi browser session and organization picker;
- OS credential-store persistence, with an owner-only file fallback only when
  the native credential store cannot be loaded or used;
- transparent refresh-token rotation;
- OpenAPI download and command-contract validation against GitBook's public
  `mochi-api` specification, which is published from the backend Git artifact;
- bounded read-only convenience commands for leads, signals, analytics,
  bookings, revenue, configuration, and connections; and
- a same-origin GET escape hatch for read operations not yet wrapped.

Phase D excludes write requests, hosted token exchange, device flow, a daemon,
an MCP server, telemetry, interactive token display, SDK generation, and the
installable skill content planned for Phase E.

## Repository and runtime

The CLI lives in the new public `TheMochiApp/mochi-agent` repository so the
Phase E skill can later be installed from the same trusted source. The npm
package is `@themochiapp/cli`; its executable is `mochi`.

The implementation uses Node.js 20+, strict TypeScript, ESM, Commander for
command parsing, Vitest for tests, and tsup for the release bundle.
`@napi-rs/keyring` is an optional dependency loaded dynamically so unsupported
platforms do not fail during process startup.

## OAuth flow

1. Discover authorization, token, registration, and revocation endpoints from
   `/.well-known/oauth-authorization-server` on the configured issuer.
2. Load the non-secret DCR client record from the owner-only config directory.
   On first use, register one public client with five fixed loopback callback
   URIs. Reusing the record avoids registration churn and rate-limit pressure.
3. Bind the first available registered callback to `127.0.0.1`; never bind all
   interfaces. Fail with an actionable error when all registered ports are busy.
4. Generate a 32-byte state value and a 64-byte PKCE verifier, then derive an
   S256 challenge.
5. Open the discovered authorization endpoint with the exact Public API
   resource `https://api.themochi.app/v1/`, the requested minimum scopes, the
   selected callback, state, and PKCE challenge.
6. Accept one callback, compare state in constant time, reject OAuth errors,
   exchange the code directly with Mochi, and close the listener. The callback
   page contains only success/failure copy and never the code or tokens.
7. Persist the returned credential bundle before reporting success. Neither
   access nor refresh tokens are written to stdout, stderr, logs, Sentry, or
   analytics.

`mochi auth login` defaults to `leads:read`, the most common initial workflow.
`--scopes` accepts a comma-separated subset of the seven read scopes. Re-running
login with more scopes uses the Phase C incremental-consent behavior.

## Credential storage and concurrency

The credential bundle contains access token, refresh token, absolute access
expiry, scopes, resource, client ID, token endpoint, revocation endpoint, and
API base URL. It is stored under service `app.themochi.cli` and account
`default` in the OS credential store.

On POSIX, if the native module cannot load or the platform store is unavailable,
the CLI uses `~/.config/mochi/credentials.json` (platform-appropriate config
root), an atomic owner-only file with directory mode `0700` and file mode
`0600`. Node cannot prove Windows ACL ownership with POSIX mode bits, so Windows
fails closed when Credential Manager is unavailable instead of storing plaintext
tokens. Status reports the storage backend without revealing its path or values.

Every refresh and credential mutation holds an owner-only cross-process
directory lease. Acquisition uses an exclusive fixed lease directory with a
nonce-bearing owner record; only preliminary stale candidates older than 60
seconds are atomically moved to unique claim directories and revalidated before
cleanup. Inside the lease, the CLI reloads the bundle before deciding whether to
refresh. It refreshes 60 seconds before expiry, atomically stores the rotated
tokens, and never retries a non-idempotent credential mutation. An authenticated
GET may retry once after a 401 only after refreshing under the same policy.

`auth logout` asks the server to revoke the refresh token before deleting the
local bundle. If remote revocation cannot be confirmed, it keeps the local
credential and returns an actionable error; `--local-only` is an explicit
escape hatch for offline cleanup.

## Command and output contract

Commands emit exactly one JSON value to stdout. Human progress such as the
browser URL goes to stderr and never includes credentials. Success uses:

```json
{ "ok": true, "data": {} }
```

Failure uses:

```json
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "Run mochi auth login." } }
```

Stable exit codes are `0` success, `2` usage, `3` authentication, `4` OAuth,
`5` network, `6` API response, and `7` local contract/storage failure.

Convenience commands map to a small typed registry of operation ID, GET path,
and required scopes. List commands accept repeatable `--query key=value`
arguments and return the API response unchanged inside `data`. The raw command
accepts only a relative `/v1/...` path and GET method. Absolute URLs, protocol-
relative URLs, userinfo, alternate hosts, and non-GET methods are rejected
before a credential is loaded, preventing bearer-token exfiltration.

## OpenAPI contract

The canonical runtime URL is:

```text
https://openapi.gitbook.com/o/M0sgy6xKutCblHRqGmE5/spec/mochi-api.json
```

The backend workflow publishes that specification from
`docs/public-api-v1-openapi.json` only after the backend `master` CI succeeds.
The CLI does not check in a second full specification.

`mochi openapi fetch --output <path>` downloads, structurally validates, and
atomically writes the current document. `mochi openapi validate` verifies that
every convenience command's operation ID, method, path, and required scopes
match the published artifact. CI runs the validator against a local canonical
fixture and a separate live-contract job against the published URL.

## Error handling and safety

- OAuth and API JSON are parsed defensively; malformed success responses fail.
- Network operations have bounded timeouts and never retry OAuth code exchange.
- 429 errors preserve `Retry-After` in structured, non-secret output.
- API error bodies are size-bounded before returning them.
- Query values are encoded with `URLSearchParams`; the CLI never concatenates
  untrusted query text into a URL.
- Custom issuer/API/OpenAPI overrides require HTTPS, except loopback HTTP for
  local development.
- The CLI contains no logging or telemetry subsystem in v1.

## Testing and release gates

Unit tests use injected HTTP, browser, listener, clock, randomness, filesystem,
and secret-store adapters. Required coverage includes PKCE vectors, state
mismatch, callback timeout, DCR reuse, malicious endpoints/paths, keychain
fallback permissions, atomic rotation, concurrent refresh, logout failure,
redaction, exit codes, malformed JSON, scope checks, 401 retry, 429 propagation,
and OpenAPI drift.

The release workflow runs formatting, lint, typecheck, unit tests, coverage,
build, package-content inspection, `npm audit --omit=dev`, and the live OpenAPI
contract check. npm publication remains manual until the package scope and
provenance token are configured; merging code alone does not publish or enable
production OAuth.
