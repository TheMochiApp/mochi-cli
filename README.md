# Mochi CLI

`mochi` is the read-only Mochi Public API client for humans, scripts, and AI agents. It uses direct browser OAuth with PKCE, stores credentials outside prompts and command history, and emits deterministic JSON.

> Rollout status: this repository is Phase D of the Public API agent-access rollout. Installing it does not enable production access. Customer OAuth must remain off until the Phase C backend/frontend are merged and Phase F adds a real backend organization-cohort gate; the exact production prerequisites are below.

## Requirements and installation

Use Node.js 20 or newer.

```bash
npm install --global @themochiapp/cli
mochi --help
```

Run without a global install:

```bash
npx --yes @themochiapp/cli --help
```

The package name is `@themochiapp/cli`; the executable is `mochi`.

## Authenticate without copying a token

```bash
mochi auth login
```

The CLI registers a public loopback OAuth client, opens Mochi in your browser, and reuses your existing signed-in Mochi session. You choose the organization and approve the exact read scopes. Authorization code plus S256 PKCE is exchanged directly between the CLI and Mochi—there is no hosted token broker.

Login defaults to the minimum `leads:read` scope. Request more read scopes only when the task needs them:

```bash
mochi auth login --scopes leads:read,signals:read
```

Allowed scopes are `analytics:read`, `bookings:read`, `config:read`, `leads:read`, `revenue:read`, `signals:read`, and `team:read`. Re-running login can ask for incremental scopes.

Check non-secret status or revoke the current grant:

```bash
mochi auth status
mochi auth logout
```

`auth logout` first revokes the refresh token and keeps local credentials if revocation cannot be confirmed. For deliberate offline cleanup, use `mochi auth logout --local-only`.

The CLI intentionally has no token flags and reads no access-token or refresh-token environment variable. Never paste a token into a command, prompt, issue, log, or source file.

## Read commands

All Phase D API commands are GET-only. List commands accept repeatable, encoded `--query key=value` options.

```bash
mochi leads list --query page_size=25 --query stage=QUALIFIED
mochi leads get LEAD_ID
mochi leads intelligence LEAD_ID
mochi signals list --query page_size=25
mochi bookings list --query page_size=25
mochi connections list
```

Analytics metrics:

```bash
mochi analytics response-times
mochi analytics reply-rate
mochi analytics funnel
mochi analytics messages
mochi analytics team
mochi analytics links
mochi analytics benchmarks
```

Revenue and configuration resources:

```bash
mochi revenue transactions
mochi revenue summary
mochi revenue manual
mochi config funnels
mochi config tags
```

Use the bounded escape hatch for an unwrapped read operation. It accepts only a relative same-origin `/v1/` target and always sends GET:

```bash
mochi api get '/v1/leads/?page_size=10'
```

Absolute URLs, alternate hosts, protocol-relative targets, path traversal, and non-GET methods are rejected before credentials are loaded.

## OpenAPI contract

```bash
mochi openapi validate
mochi openapi fetch --output ./mochi-openapi.json
```

Successful live validation reports the published versions and bounded registry size without dumping the document:

```json
{ "ok": true, "data": { "openapiVersion": "3.0.3", "apiVersion": "1.0.0", "operationCount": 18 } }
```

The canonical specification is the public [GitBook OpenAPI artifact](https://openapi.gitbook.com/o/M0sgy6xKutCblHRqGmE5/spec/mochi-api.json). Mochi's backend workflow publishes it from the checked-in `docs/public-api-v1-openapi.json` Git artifact only after backend `master` CI succeeds. The CLI does not ship a second specification: validation checks every wrapped operation ID, GET path, and required scope against that published contract.

## JSON and exit-code contract

stdout contains exactly one JSON value followed by one newline. API responses remain unchanged inside `data`:

```json
{ "ok": true, "data": { "authenticated": true, "scopes": ["leads:read"], "storageBackend": "keyring" } }
```

Failures never include stacks or credentials:

```json
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "Run mochi auth login." } }
```

Progress that requires a person, such as a manual browser-open fallback, goes to stderr. Stable process exit codes are:

| Exit | Meaning                           |
| ---: | --------------------------------- |
|    0 | Success                           |
|    2 | Invalid command or arguments      |
|    3 | Authentication or scope required  |
|    4 | OAuth protocol failure            |
|    5 | Network failure                   |
|    6 | Mochi API response failure        |
|    7 | Local storage or contract failure |

Agent rule: parse stdout once as JSON, branch first on `ok`, and use the exit code for the failure class. Never scrape human copy for secrets or retry non-idempotent OAuth operations.

## Credential storage

The preferred backend is the operating system credential store under service `app.themochi.cli` and account `default`. The native keyring module loads lazily.

If the native keyring is unavailable on macOS or Linux, the CLI falls back to an atomic owner-only file: the configuration directory is mode `0700` and the credential file is mode `0600`. The default root is macOS Application Support, `$XDG_CONFIG_HOME/mochi`, or `~/.config/mochi`; `MOCHI_CONFIG_DIR` may select an absolute POSIX development path.

Windows requires Credential Manager and fails closed when it is unavailable. The CLI never falls back to a plaintext file on Windows because Node's POSIX mode bits cannot prove a secure Windows ACL. `MOCHI_CONFIG_DIR` is therefore rejected on Windows. In addition to the full Windows test suite, CI dynamically loads the optional native module and performs an isolated set/get/delete round trip with unique service and account names on the ephemeral Windows runner. It never touches `app.themochi.cli/default` or prints the test value.

Refresh-token rotation is transparent and serialized by a cross-process directory lease. `auth status` reports `keyring` or `file-0600` but never prints a credential path or value.

## Production prerequisites and dark deploy

Merging or publishing this CLI changes no Mochi production configuration. The current Phase C OAuth switch is global: `PUBLIC_API_OAUTH_ENABLED` is not an organization allowlist. `VITE_PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` controls only visibility of Settings → Developers; it does not gate CLI consent, OAuth authorization, refresh, authentication, or `/v1/` traffic.

Do not describe the current controls as a named-organization OAuth canary, and do not turn on global OAuth “for one organization.” Customer OAuth enablement is forbidden until Phase F adds and enables a reviewed backend organization-cohort gate. After that gate exists, operators must:

1. Merge and deploy the Phase C backend and frontend consent work.
2. Keep the OAuth resource exactly `https://api.themochi.app/v1/` in backend `PUBLIC_API_OAUTH_RESOURCE` and frontend `VITE_PUBLIC_API_OAUTH_RESOURCE`.
3. Configure and verify the Phase F backend organization cohort before setting backend `PUBLIC_API_OAUTH_ENABLED=true` for Public API OAuth.
4. Set backend `PUBLIC_API_ENABLED=true` only when authenticated Public API reads are ready globally under the approved API access controls.
5. If Settings → Developers is also being exposed, separately set backend `PUBLIC_API_DEVELOPERS_ENABLED=true`, configure `VITE_PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS`, and redeploy the Vite bundle. This UI cohort is not an OAuth security boundary.
6. Complete the Phase F rollout checklist with read-only scopes, monitoring, and a rollback owner.

All backend flags default to false, and the frontend Developers cohort defaults empty. Disabling `PUBLIC_API_OAUTH_ENABLED` removes OAuth metadata and stops new grants, refresh, and authentication of existing Public API OAuth tokens; API-key traffic remains available if `PUBLIC_API_ENABLED` stays true. Disabling `PUBLIC_API_ENABLED` rejects all Public API authentication and reads, including both OAuth and API keys. Disabling the Developers UI alone does not revoke credentials already issued.

Phase D does not add write scopes or write commands and does not change MCP, Zapier, first-party application traffic, send enforcement, or P5 pacing controls.

## Troubleshooting

- `AUTH_REQUIRED`: run `mochi auth login` in a terminal with browser access.
- `MISSING_SCOPE`: re-run login with the smallest required read scopes.
- `OAUTH_*`: confirm the Phase C frontend/backend are deployed and the OAuth resource matches exactly. Production OAuth must remain off until the Phase F backend organization-cohort gate is deployed and configured.
- `CREDENTIAL_STORAGE_UNAVAILABLE` on Windows: repair Credential Manager/native keyring access; plaintext fallback is intentionally disabled.
- `CREDENTIAL_LOCK_TIMEOUT`: wait for the other CLI process to finish, then retry. The CLI reclaims only fully revalidated stale leases.
- `OPENAPI_DRIFT`: do not bypass it. Check the published backend OpenAPI change and update the bounded command registry deliberately.
- `429`/exit 6: honor `error.details.retryAfter` before retrying.
- Logout cannot reach Mochi: retry `mochi auth logout`; use `--local-only` only when you intentionally accept that server-side revocation was not confirmed.

Public API documentation is available in [GitBook](https://mochi-9.gitbook.io/mochi-api/). Report vulnerabilities through the private route in [SECURITY.md](SECURITY.md). Maintainers must complete [RELEASING.md](RELEASING.md) before any npm publication.
