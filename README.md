# Mochi CLI

`mochi` is the read-only Mochi Public API client for humans, scripts, and AI agents. It uses direct browser OAuth with PKCE, stores credentials outside prompts and command history, and emits deterministic JSON.

> Rollout status: this repository is Phase D of the Public API agent-access rollout. Production is now a controlled exact-organization pilot: the authoritative backend OAuth and Developers cohorts and matching frontend Developers cohort are live, and both global switches are enabled. OAuth remains limited to the seven read-only scopes, while approved pilot organizations may separately create read/write API keys. Flows remain disabled and P5 enforcement remains independent. Using this repository or skill changes none of those production controls.

## Install the Mochi API skill

Install the portable, high-level skill directly from this repository:

```bash
npx skills add TheMochiApp/mochi-cli --skill mochi-api
```

The skill helps an agent choose between interactive OAuth, an unattended API key, an existing MCP connection, and a registered OAuth application. It then reads [the live LLM index](https://docs.themochi.app/llms.txt), selects the smallest current task guide, and inspects the generated OpenAPI contract for exact request details.

The skill does not copy the endpoint catalog and does not contain credentials. Routine API changes reach agents through Git-backed docs and OpenAPI without requiring a skill release. The skill is repository content and remains outside the `@themochiapp/cli` npm tarball.

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

## Guided first read

After installing the skill and CLI, use one command for the interactive local setup check:

```bash
mochi quickstart
```

`quickstart` validates the current published OpenAPI contract before touching authentication, checks non-secret login status, opens the minimum-scope browser OAuth flow only when needed, verifies the stored grant, and completes one read-only canary. It discards the customer response body and returns only a structured verification summary with the live documentation index, contract versions, granted read scopes, storage backend, and canary result.

Use the returned `docsIndexUrl` to select the smallest current task guide before continuing with a real task. If the OpenAPI contract is unavailable or incompatible, `quickstart` stops before login. Existing OAuth origin binding, PKCE, credential storage, refresh, and JSON error protections remain unchanged.

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

The canonical specification is the public [GitBook OpenAPI artifact](https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json). Mochi's backend workflow publishes it from the checked-in `docs/public-api-v1-openapi.json` Git artifact only after backend `master` CI succeeds. The CLI does not ship a second specification: validation checks every wrapped operation ID, GET path, and required scope against that published contract.

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

## Production controlled pilot and rollback

Merging or publishing this CLI changes no Mochi production configuration. The backend has separate default-empty exact-UUID cohorts for OAuth and Settings → Developers. `PUBLIC_API_OAUTH_ENABLED_ORG_IDS` is the organization security boundary for Public API OAuth authorization, consent, code exchange, refresh, and bearer authentication; `PUBLIC_API_OAUTH_ENABLED` remains its global on/off switch. Together, backend `PUBLIC_API_DEVELOPERS_ENABLED` and `PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` authorize every Settings → Developers list, create, and revoke route. The Developers and OAuth cohorts are independent: changing one never enables the other. `VITE_PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` controls only Settings → Developers frontend visibility and does not gate backend routes, CLI consent, OAuth authorization, refresh, authentication, or `/v1/` traffic. Backend authorization is authoritative; frontend visibility is not authorization.

Production is now a controlled exact-organization pilot. The final reviewed merge result of [backend PR #1798](https://github.com/TheMochiApp/mochi-backend/pull/1798) is deployed to every backend web process. Access is restricted to the authoritative exact UUID entries in `PUBLIC_API_OAUTH_ENABLED_ORG_IDS`, `PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS`, and the deployed `VITE_PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` frontend cohort; this public repository deliberately does not duplicate the changing customer cohort. Backend `PUBLIC_API_OAUTH_ENABLED=true` and `PUBLIC_API_DEVELOPERS_ENABLED=true` are both live.

OAuth remains limited to the seven read-only scopes: `analytics:read`, `bookings:read`, `config:read`, `leads:read`, `revenue:read`, `signals:read`, and `team:read`. Approved pilot organizations are separately authorized to create read/write API keys through Settings → Developers; that API-key entitlement does not add an OAuth write scope. `PUBLIC_API_FLOWS_ENABLED=false`, so flow routes and workers remain unavailable. P5 enforcement remains independently controlled and is not enabled or widened by the Public API, OAuth, Developers, or API-key pilot settings.

Operators must preserve these controlled-pilot conditions and repeat them before any reactivation or cohort expansion:

1. Confirm the final reviewed merge result of [backend PR #1798](https://github.com/TheMochiApp/mochi-backend/pull/1798) is deployed to every backend web process.
2. Keep the OAuth resource exactly `https://api.themochi.app/v1/` in backend `PUBLIC_API_OAUTH_RESOURCE` and frontend `VITE_PUBLIC_API_OAUTH_RESOURCE`, and keep the OAuth scope set at the exact seven reads above.
3. Keep `PUBLIC_API_OAUTH_ENABLED_ORG_IDS` restricted to the exact approved lowercase canonical UUID, then verify cohort consent/exchange/refresh/bearer behavior and non-cohort denial while `PUBLIC_API_OAUTH_ENABLED=true`.
4. Keep Settings → Developers active only while all three controls match: the deployed frontend cohort contains the exact organization, backend `PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` contains the exact organization, and backend `PUBLIC_API_DEVELOPERS_ENABLED=true`. Backend authorization remains authoritative regardless of frontend visibility.
5. Keep flows false and P5 enforcement independently configured. Do not infer flow or outbound-enforcement approval from API-key, Developers, or OAuth access.
6. Monitor OAuth authorize/exchange/refresh, key creation/revocation, Public API 401/403/404/429/5xx rates, tenant isolation, audit persistence, API latency, and MCP/Zapier regressions with a named rollback owner.

All backend flags default to false. Both backend organization cohorts and the frontend Developers cohort default empty, so omission fails closed; leave backend `PUBLIC_API_DEVELOPERS_ENABLED_ORG_IDS` unset or empty for that default rather than configuring the literal text `[]`. The live pilot values above are deliberate overrides, not new defaults.

For a Developers-only rollback, set `PUBLIC_API_DEVELOPERS_ENABLED=false` first, restart every backend web process, and verify all Developers routes return 404; then remove the UUID from the backend Developers cohort and hide the matching frontend entry if required. Leave the independent OAuth switch and cohort unchanged. Revoke any affected API keys separately; hiding Developers does not invalidate credentials already issued.

For an OAuth-only rollback, set `PUBLIC_API_OAUTH_ENABLED=false` and restart every backend web process for a global stop, or remove only the affected UUID from `PUBLIC_API_OAUTH_ENABLED_ORG_IDS` for a targeted stop. Either action stops affected exchanges, refreshes, and Public API OAuth bearer use; API-key and empty-resource MCP/Zapier traffic remains available while `PUBLIC_API_ENABLED` stays true. Leave the Developers settings unchanged unless the incident also affects credential management. For a broader Public API authentication or tenant-isolation incident, set `PUBLIC_API_ENABLED=false`; keep flows and P5 controls on their separate rollback paths.

The Phase D CLI remains GET-only and does not add OAuth write scopes or write commands. The pilot's separately authorized API keys may use approved write scopes and routes outside this CLI. This rollout does not change MCP, Zapier, first-party application traffic, flow availability, send enforcement, or P5 pacing controls.

## Troubleshooting

- `AUTH_REQUIRED`: run `mochi auth login` in a terminal with browser access.
- `MISSING_SCOPE`: re-run login with the smallest required read scopes.
- `OAUTH_*`: confirm the exact pilot organization remains in `PUBLIC_API_OAUTH_ENABLED_ORG_IDS`, the backend and frontend OAuth resources match exactly, and the requested scopes are within the seven-read production set. Non-cohort denial is expected; do not bypass a targeted or global rollback.
- `CREDENTIAL_STORAGE_UNAVAILABLE` on Windows: repair Credential Manager/native keyring access; plaintext fallback is intentionally disabled.
- `CREDENTIAL_LOCK_TIMEOUT`: wait for the other CLI process to finish, then retry. The CLI reclaims only fully revalidated stale leases.
- `OPENAPI_DRIFT`: do not bypass it. Check the published backend OpenAPI change and update the bounded command registry deliberately.
- `429`/exit 6: honor `error.details.retryAfter` before retrying.
- Logout cannot reach Mochi: retry `mochi auth logout`; use `--local-only` only when you intentionally accept that server-side revocation was not confirmed.

Public API documentation is available at [docs.themochi.app](https://docs.themochi.app). See [skill maintenance](docs/skill-maintenance.md) before changing agent guidance. Report vulnerabilities through the private route in [SECURITY.md](SECURITY.md). Maintainers must complete [RELEASING.md](RELEASING.md) before any npm publication.
