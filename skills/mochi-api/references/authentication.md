# Authentication

Choose authentication by where the work runs. Do not choose by whichever credential appears easiest to obtain.

## Interactive local agent or developer

Use Mochi CLI OAuth when a customer and agent share a trusted local machine. Run `mochi auth login` from the terminal and let the customer approve the organization and minimum scopes in the browser. An existing signed-in browser session can avoid another password entry, but it does not skip consent.

The CLI stores the grant in the OS keychain or another documented secure local backend. The agent uses structured CLI results and never inspects credential storage. Use `mochi auth status` for non-secret state and `mochi auth logout` when the grant is no longer needed.

## Unattended workload

Use an organization-scoped API key for CI, scheduled jobs, hosted agents, and servers. An operator creates the key with minimum scopes, stores it in a server-side secret manager, and injects it at runtime. Do not run browser login on an ephemeral worker or place the key in source, arguments, output, logs, screenshots, tickets, or prompts.

Give separate workloads separate keys so they can be rotated and revoked independently.

## Existing MCP connection

Continue using the existing MCP connection when it already supports the customer's task. Do not export, exchange, or convert its credential. Installing this skill does not require reconnection, and an MCP credential does not silently become a Public API credential.

## Registered OAuth application

A third-party browser client uses a registered OAuth application and the current authorization-code flow with PKCE. The application owns its registered redirect, consent, secure refresh lifecycle, and revocation behavior. It must not scrape CLI storage.

## Failure rule

Authentication or authorization failure is never solved by exposing a credential. Read the current failure guide, verify the intended organization and minimum scopes, and use the supported login, rotation, or revocation path. If a credential may be exposed, stop using it and have the operator revoke or rotate it without copying the value into the incident record.
