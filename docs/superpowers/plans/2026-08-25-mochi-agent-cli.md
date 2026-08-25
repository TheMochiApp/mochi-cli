# Mochi Agent CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the read-only `mochi` CLI with direct PKCE OAuth, secure credential storage, transparent refresh, OpenAPI validation, and deterministic JSON output.

**Architecture:** A strict TypeScript ESM package keeps platform effects behind injected adapters. OAuth, storage, authenticated HTTP, the read-command registry, and CLI presentation are separate units; production composition happens only in `src/main.ts`. Credentials never cross the output boundary.

**Tech Stack:** Node.js 20+, TypeScript, Commander, optional `@napi-rs/keyring`, Vitest, ESLint, Prettier, tsup, npm.

**Spec:** `docs/superpowers/specs/2026-08-25-mochi-agent-cli-design.md`

## Global Constraints

- Package name is `@themochiapp/cli`; executable name is `mochi`; runtime floor is Node.js 20.
- Public API OAuth resource is exactly `https://api.themochi.app/v1/`.
- Default login scope is exactly `leads:read`; only the documented read-scope allowlist is accepted.
- No command other than OAuth token/revocation protocol calls may send a non-GET request in this phase.
- A raw API target must be a relative same-origin path beginning `/v1/`.
- stdout contains one JSON value; tokens, authorization codes, and PKCE verifiers never enter output or errors.
- Native keyring loading is lazy; fallback directory is `0700`, fallback files are `0600`, and writes are atomic.
- Tests precede production code and every red test must fail for the intended missing behavior.

---

### Task 1: Package foundation and deterministic process contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `src/core/errors.ts`
- Create: `src/core/output.ts`
- Create: `src/core/config.ts`
- Test: `test/core/output.test.ts`
- Test: `test/core/config.test.ts`

**Interfaces:**
- Produces: `CliError`, `ExitCode`, `successJson`, `failureJson`, `writeResult`, `RuntimeConfig`, and `loadRuntimeConfig`.
- Consumes: no application interfaces.

- [ ] **Step 1: Add the package/toolchain manifest**

Use this runtime dependency boundary:

```json
{
  "name": "@themochiapp/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mochi": "dist/cli.js" },
  "engines": { "node": ">=20" },
  "dependencies": { "commander": "^14.0.0" },
  "optionalDependencies": { "@napi-rs/keyring": "^1.3.0" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "ci": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

- [ ] **Step 2: Write failing output and configuration tests**

```ts
expect(successJson({ authenticated: true })).toEqual({
  ok: true,
  data: { authenticated: true },
});
expect(failureJson(new CliError("AUTH_REQUIRED", "Run mochi auth login.", 3))).toEqual({
  ok: false,
  error: { code: "AUTH_REQUIRED", message: "Run mochi auth login." },
});
expect(() => loadRuntimeConfig({ MOCHI_API_URL: "https://evil.example/v1" })).toThrow("API base");
expect(loadRuntimeConfig({}).openapiUrl).toBe(
  "https://openapi.gitbook.com/o/M0sgy6xKutCblHRqGmE5/spec/mochi-api.json",
);
```

- [ ] **Step 3: Run the tests and verify the missing-module failure**

Run: `npx vitest run test/core/output.test.ts test/core/config.test.ts`

Expected: FAIL because `src/core/output.ts` and `src/core/config.ts` do not exist.

- [ ] **Step 4: Implement the process contract and validated configuration**

Define exact exit codes:

```ts
export const ExitCode = {
  Success: 0,
  Usage: 2,
  Authentication: 3,
  OAuth: 4,
  Network: 5,
  Api: 6,
  Local: 7,
} as const;

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
```

`writeResult` must serialize once, append one newline, and set
`process.exitCode`; it must never serialize an `Error` object or stack.
`loadRuntimeConfig` accepts HTTPS overrides and loopback HTTP only, strips
trailing slashes from the API/issuer base, and rejects API bases containing a
path other than `/`.

- [ ] **Step 5: Run tests, typecheck, lint, and commit**

Run: `npm test -- test/core/output.test.ts test/core/config.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

Commit: `feat: establish CLI process contract`

---

### Task 2: Secure credential persistence and cross-process lock

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/paths.ts`
- Create: `src/storage/file-store.ts`
- Create: `src/storage/keyring-store.ts`
- Create: `src/storage/credential-store.ts`
- Create: `src/storage/lock.ts`
- Test: `test/storage/file-store.test.ts`
- Test: `test/storage/credential-store.test.ts`
- Test: `test/storage/lock.test.ts`

**Interfaces:**
- Produces: `CredentialBundle`, `PublicClientRecord`, `SecretStore`, `CredentialRepository`, `createCredentialRepository`, and `withCredentialLock`.
- Consumes: `CliError` and `RuntimeConfig` from Task 1.

- [ ] **Step 1: Write failing permission, fallback, and serialization tests**

```ts
await fileStore.set("secret-json");
expect((await stat(configDir)).mode & 0o777).toBe(0o700);
expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
expect(await fileStore.get()).toBe("secret-json");

const repository = await createCredentialRepository({
  keyringLoader: async () => {
    throw new Error("native binding unavailable");
  },
  fileStore,
});
expect(repository.backend).toBe("file-0600");
```

Add a two-contender lock test proving the second callback starts only after the
first callback finishes, plus a stale-lock test using an injected clock.

- [ ] **Step 2: Run tests and verify they fail because storage is absent**

Run: `npx vitest run test/storage`

Expected: FAIL with unresolved storage imports.

- [ ] **Step 3: Implement typed bundles and atomic owner-only files**

Use this credential shape:

```ts
export interface CredentialBundle {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  scopes: string[];
  resource: "https://api.themochi.app/v1/";
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  apiBaseUrl: string;
}
```

Validate every decoded field and reject unknown resource/invalid URLs. Write to
a sibling random temporary file with mode `0600`, `fsync`, rename, and reapply
mode. Never reuse a broad environment variable for paths.

- [ ] **Step 4: Implement lazy native keyring selection**

The production loader dynamically imports `@napi-rs/keyring`, constructs
`new Entry("app.themochi.cli", "default")`, and probes with `getPassword()`.
Unavailable imports or platform errors choose the explicit file backend. A
malformed stored value raises `CREDENTIAL_INVALID`; it must not silently erase
or replace the bundle.

- [ ] **Step 5: Implement the lock**

Use an exclusive `open(lockPath, "wx", 0o600)` loop with an injected 50 ms
backoff, a 10-second acquisition deadline, and stale-lock removal only when the
stored timestamp is older than 60 seconds. Always close/unlink in `finally` and
verify the lock nonce before unlinking.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- test/storage && npm run typecheck && npm run lint`

Expected: PASS.

Commit: `feat: add secure credential storage`

---

### Task 3: OAuth discovery, DCR, PKCE, and loopback login

**Files:**
- Create: `src/oauth/types.ts`
- Create: `src/oauth/http.ts`
- Create: `src/oauth/pkce.ts`
- Create: `src/oauth/discovery.ts`
- Create: `src/oauth/client-registration.ts`
- Create: `src/oauth/callback-server.ts`
- Create: `src/oauth/browser.ts`
- Create: `src/oauth/login.ts`
- Test: `test/oauth/pkce.test.ts`
- Test: `test/oauth/discovery.test.ts`
- Test: `test/oauth/client-registration.test.ts`
- Test: `test/oauth/callback-server.test.ts`
- Test: `test/oauth/login.test.ts`

**Interfaces:**
- Produces: `OAuthMetadata`, `OAuthHttp`, `createPkce`, `discoverOAuth`, `ensurePublicClient`, `waitForOAuthCallback`, `openBrowser`, and `login`.
- Consumes: `CredentialRepository`, `PublicClientRecord`, `CredentialBundle`, `RuntimeConfig`, `CliError`, and `withCredentialLock`.

- [ ] **Step 1: Write and fail the RFC 7636 PKCE vector test**

```ts
expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
  "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
);
```

Run: `npx vitest run test/oauth/pkce.test.ts`

Expected: FAIL because `pkceChallenge` is missing.

- [ ] **Step 2: Implement PKCE and discovery with strict endpoint validation**

Generate verifier/state with injected `randomBytes`; use base64url without
padding and `sha256`. Discovery requires issuer, authorization, token,
registration, and revocation endpoints to be HTTPS (loopback HTTP only under a
loopback issuer override). Reject metadata that changes origin unexpectedly
unless it is the production Mochi API/frontend authorization pair.

- [ ] **Step 3: Write and fail DCR reuse tests**

```ts
expect(await ensurePublicClient(deps)).toEqual(savedClient);
expect(http.post).not.toHaveBeenCalled();
```

Add first-registration coverage asserting `token_endpoint_auth_method: "none"`,
`grant_types: ["authorization_code", "refresh_token"]`,
`response_types: ["code"]`, and exactly five `http://127.0.0.1:<port>/callback`
URIs. Reject a registration response containing a different URI set or secret.

- [ ] **Step 4: Implement reusable DCR registration**

Use fixed ports `48151` through `48155`. Save only client ID and URI list in
the non-secret owner-only client file. Never register when a valid saved record
exists for the current registration endpoint.

- [ ] **Step 5: Write and fail callback-server tests**

Cover loopback-only binding, first-free-port selection, state mismatch, OAuth
error callback, five-minute timeout, one-request closure, and an HTML response
that contains neither code nor state.

- [ ] **Step 6: Implement callback and browser adapters**

`waitForOAuthCallback` returns `{ code, redirectUri }` only after constant-time
state validation. `openBrowser` uses argument-array child processes: `open` on
macOS, `rundll32 url.dll,FileProtocolHandler` on Windows, and `xdg-open` on
Linux. Failure returns the safe authorization URL for stderr display.

- [ ] **Step 7: Write and fail the composed login tests**

Assert the authorization URL has exact resource, scope, client, callback,
state, `code_challenge`, and `code_challenge_method=S256`; token exchange has
the verifier and never retries; stored bundle has an absolute expiry; final
result contains scopes/storage backend but no token/code/verifier.

- [ ] **Step 8: Implement login and commit**

Accept `readonlyScopes: string[]`; normalize/sort/deduplicate against:

```ts
const READ_SCOPES = [
  "analytics:read",
  "bookings:read",
  "config:read",
  "leads:read",
  "revenue:read",
  "signals:read",
  "team:read",
] as const;
```

The token response must contain non-empty access/refresh tokens and positive
`expires_in`. Store the bundle under the credential lock before returning.

Run: `npm test -- test/oauth test/storage && npm run typecheck && npm run lint`

Expected: PASS.

Commit: `feat: add direct PKCE browser login`

---

### Task 4: Transparent refresh, authenticated GET, status, and logout

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/authenticated-client.ts`
- Create: `src/auth/status.ts`
- Create: `src/auth/logout.ts`
- Test: `test/api/authenticated-client.test.ts`
- Test: `test/auth/status.test.ts`
- Test: `test/auth/logout.test.ts`

**Interfaces:**
- Produces: `ApiResponse`, `AuthenticatedClient.get`, `authStatus`, and `logout`.
- Consumes: `OAuthHttp`, `CredentialRepository`, `CredentialBundle`, `withCredentialLock`, `CliError`, and `RuntimeConfig`.

- [ ] **Step 1: Write and fail refresh-rotation tests**

Cover: valid access token avoids refresh; expiry within 60 seconds refreshes;
two concurrent clients cause only one refresh after reload-under-lock; rotated
tokens are stored before request; malformed refresh response preserves the old
bundle; and a 401 triggers at most one refresh/retry.

- [ ] **Step 2: Run the targeted test and confirm missing implementation**

Run: `npx vitest run test/api/authenticated-client.test.ts`

Expected: FAIL because `AuthenticatedClient` is missing.

- [ ] **Step 3: Implement refresh and safe GET transport**

Reject the target before loading credentials unless it parses against
`apiBaseUrl` to the same origin, has no username/password/hash, and its pathname
starts `/v1/`. Add `Authorization: Bearer` only after validation. Use a
15-second timeout. Parse response text with a 1 MiB ceiling; JSON-parse when
possible, preserve status/request ID/retry-after, and never include headers or
tokens in an error.

- [ ] **Step 4: Write and fail status/logout tests**

Status returns authenticated, scopes, resource, expiry, expired boolean, and
storage backend only. Logout posts the refresh token and client ID to the
discovered revocation endpoint, removes local credentials only on 2xx, and
supports `localOnly: true` without network access.

- [ ] **Step 5: Implement status/logout and commit**

Run: `npm test -- test/api test/auth && npm run typecheck && npm run lint`

Expected: PASS.

Commit: `feat: add authenticated read transport`

---

### Task 5: OpenAPI validation and bounded read-command registry

**Files:**
- Create: `src/openapi/types.ts`
- Create: `src/openapi/fetch.ts`
- Create: `src/openapi/validate.ts`
- Create: `src/commands/registry.ts`
- Create: `src/commands/query.ts`
- Create: `test/fixtures/public-api-openapi.json`
- Test: `test/openapi/validate.test.ts`
- Test: `test/commands/registry.test.ts`
- Test: `test/commands/query.test.ts`

**Interfaces:**
- Produces: `READ_OPERATIONS`, `parseQueryPairs`, `fetchOpenApi`, `writeOpenApi`, and `validateReadOperations`.
- Consumes: `RuntimeConfig`, `AuthenticatedClient`, and `CliError`.

- [ ] **Step 1: Create a minimal canonical OpenAPI fixture and failing drift test**

The fixture contains only the real GET operations wrapped by the CLI. Assert
that changing an operation ID, method, path, or `x-mochi-required-scope` makes
validation fail with `OPENAPI_DRIFT` and the operation key, without dumping the
document.

- [ ] **Step 2: Run the tests and confirm the validator is absent**

Run: `npx vitest run test/openapi/validate.test.ts test/commands/registry.test.ts`

Expected: FAIL because registry/validator modules are missing.

- [ ] **Step 3: Implement the registry**

Include these v1 keys and exact operations:

```ts
export const READ_OPERATIONS = {
  "leads.list": ["get_public_leads_list", "/v1/leads/", ["leads:read"]],
  "leads.get": ["get_public_lead_detail", "/v1/leads/{lead_id}/", ["leads:read"]],
  "leads.intelligence": [
    "get_public_lead_intelligence",
    "/v1/leads/{lead_id}/intelligence/",
    ["leads:read", "signals:read"],
  ],
  "signals.list": ["get_public_signals_list", "/v1/signals/", ["signals:read"]],
  "bookings.list": ["get_public_bookings_list", "/v1/bookings/", ["bookings:read"]],
  "revenue.transactions": [
    "get_public_revenue_transactions",
    "/v1/revenue/transactions/",
    ["revenue:read"],
  ],
  "revenue.summary": ["get_public_revenue_summary", "/v1/revenue/summary/", ["revenue:read"]],
  "revenue.manual": ["get_public_revenue_manual", "/v1/revenue/manual/", ["revenue:read"]],
  "config.funnels": ["get_public_config_funnels", "/v1/config/funnels/", ["config:read"]],
  "config.tags": ["get_public_config_tags", "/v1/config/tags/", ["config:read"]],
  "connections.list": ["get_public_connections_list", "/v1/connections/", ["config:read"]],
  "analytics.response-times": [
    "get_public_analytics_response_times",
    "/v1/analytics/response-times/",
    ["analytics:read"],
  ],
  "analytics.reply-rate": [
    "get_public_analytics_reply_rate",
    "/v1/analytics/reply-rate/",
    ["analytics:read"],
  ],
  "analytics.funnel": ["get_public_analytics_funnel", "/v1/analytics/funnel/", ["analytics:read"]],
  "analytics.messages": [
    "get_public_analytics_messages",
    "/v1/analytics/messages/",
    ["analytics:read"],
  ],
  "analytics.team": ["get_public_analytics_team", "/v1/analytics/team/", ["analytics:read"]],
  "analytics.links": ["get_public_analytics_links", "/v1/analytics/links/", ["analytics:read"]],
  "analytics.benchmarks": [
    "get_public_analytics_benchmarks",
    "/v1/analytics/benchmarks/",
    ["analytics:read"],
  ],
} as const;
```

- [ ] **Step 4: Implement safe query/path handling and OpenAPI fetch**

`parseQueryPairs` requires one non-empty key before `=`, permits repeated keys,
and uses `URLSearchParams`. Path templates replace only named placeholders with
`encodeURIComponent`. OpenAPI fetch allows no authorization header, enforces a
15-second timeout and 2 MiB ceiling, validates `openapi`, `info.version`, and
`paths`, then atomically writes an optional output file.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- test/openapi test/commands && npm run typecheck && npm run lint`

Expected: PASS.

Commit: `feat: add read command contract validation`

---

### Task 6: CLI command composition and end-to-end redaction

**Files:**
- Create: `src/cli/program.ts`
- Create: `src/cli/commands/auth.ts`
- Create: `src/cli/commands/openapi.ts`
- Create: `src/cli/commands/read.ts`
- Create: `src/main.ts`
- Create: `src/cli.ts`
- Test: `test/cli/program.test.ts`
- Test: `test/cli/redaction.test.ts`

**Interfaces:**
- Produces: `createProgram`, `runCli`, and the `mochi` executable.
- Consumes: every production interface from Tasks 1–5.

- [ ] **Step 1: Write failing command-shape tests**

Use injected service fakes and an in-memory stdout/stderr. Cover:

```text
mochi auth login [--scopes leads:read,signals:read]
mochi auth status
mochi auth logout [--local-only]
mochi openapi fetch --output ./openapi.json
mochi openapi validate
mochi leads list --query stage=NEW
mochi leads get <lead-id>
mochi leads intelligence <lead-id>
mochi signals list --query cursor=next_cursor_value
mochi analytics <response-times|reply-rate|funnel|messages|team|links|benchmarks>
mochi bookings list
mochi revenue <transactions|summary|manual>
mochi config <funnels|tags>
mochi connections list
mochi api get /v1/send-policy/
```

Unknown commands/flags exit 2 with one JSON error. Missing scopes exit 3 before
HTTP. API success is wrapped once; API failure preserves bounded status/code.

- [ ] **Step 2: Run tests and verify command composition is missing**

Run: `npx vitest run test/cli/program.test.ts`

Expected: FAIL because `createProgram` is missing.

- [ ] **Step 3: Implement Commander composition**

Disable Commander's implicit process exit and default help/error output. Route
all completion through `writeResult`. `--help` returns a success JSON object
containing command names and docs URL, not ANSI text. Do not accept token,
secret, verifier, authorization-code, or bearer flags.

- [ ] **Step 4: Write and pass the redaction test**

Seed every injected error/HTTP body with unique access token, refresh token,
authorization code, and verifier canaries. Assert combined stdout/stderr and
serialized errors contain none of them for login, refresh, API, and logout
failures.

- [ ] **Step 5: Implement production composition and commit**

`src/main.ts` creates real adapters; `src/cli.ts` contains only the shebang,
imports `runCli`, and handles a final unknown exception as `UNEXPECTED` without
stack/message leakage.

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: PASS and `node dist/cli.js --help` emits one JSON value.

Commit: `feat: expose agent-friendly read CLI`

---

### Task 7: Documentation, CI, packaging, and live contract gate

**Files:**
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/live-contract.yml`
- Create: `.github/workflows/publish.yml`
- Create: `scripts/verify-package.mjs`
- Modify: `package.json`
- Test: `test/package/package.test.ts`

**Interfaces:**
- Produces: contributor/release contract and installable npm tarball.
- Consumes: built `dist/cli.js` and the published OpenAPI URL.

- [ ] **Step 1: Write and fail package-content tests**

Run `npm pack --json --dry-run` from the test and assert the tarball contains
only `dist/**`, `README.md`, `SECURITY.md`, `LICENSE`, and `package.json`; reject
source maps containing sources content, tests, fixtures, credentials, `.env`,
or design work files. Assert the executable file begins with a Node shebang.

- [ ] **Step 2: Add human and agent-safe documentation**

README must document Node 20, install/run commands, browser consent, scope
selection, keychain/file behavior, every v1 command, JSON/exit-code contract,
OpenAPI provenance, production flags required before login works, and the fact
that Phase D is read-only. SECURITY must prohibit tokens in issues and provide
the private security-reporting route.

- [ ] **Step 3: Add CI and live-contract workflows**

`ci.yml` runs `npm ci`, `npm run ci`, `npm audit --omit=dev --audit-level=high`,
and `node scripts/verify-package.mjs` on pull requests. Use Node 20 and pinned
major action versions. `live-contract.yml` runs daily and manually, downloads
the public GitBook artifact, and calls the same validator used by the CLI.

- [ ] **Step 4: Add a manual provenance publication workflow**

`publish.yml` requires workflow dispatch, a `v*` tag matching `package.json`,
the npm `production` environment, OIDC `id-token: write`, `npm publish
--provenance --access public`, and the full CI command. It must not run on merge
or contain an npm token literal.

- [ ] **Step 5: Verify the complete repository**

Run:

```bash
npm ci
npm run ci
npm audit --omit=dev --audit-level=high
node scripts/verify-package.mjs
node dist/cli.js --help
node dist/cli.js openapi validate
git diff --check
```

Expected: all local gates pass; the live validation reports OpenAPI version
`1.0.0` and every registry operation matches.

- [ ] **Step 6: Commit**

Commit: `docs: add CLI release and security contract`
