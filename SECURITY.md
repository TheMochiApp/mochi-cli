# Security policy

## Report privately

Use [GitHub's private security advisory form](https://github.com/TheMochiApp/mochi-cli/security/advisories/new) for suspected vulnerabilities in this CLI. Include the affected version, platform, impact, and minimal reproduction. If the form is unavailable, contact Mochi support and ask for a private security-reporting channel before sharing technical details.

Do not open a public issue for a vulnerability before it is triaged. Never include access tokens, refresh tokens, authorization codes, PKCE verifiers, credential files, unredacted HTTP headers, customer data, or secrets in GitHub issues, advisory text, chat, terminal transcripts, screenshots, or logs. Redact those values even in a private report; Mochi does not need live credentials to investigate.

If a live credential may have been exposed, revoke it with `mochi auth logout` or Settings → Developers and notify the affected organization administrator immediately.

## Skill scanner note

The `mochi-api` skill intentionally uses the live `https://docs.themochi.app/llms.txt` router and canonical OpenAPI artifact instead of copying a stale endpoint catalog. Because it fetches those remote sources, the current skills.sh/Snyk scan reports one MEDIUM W011 indirect-prompt-injection warning with a low `0.10` risk score. This is an expected signal about the remote-document trust boundary, not evidence that fetched content is trusted.

The installed skill treats fetched content as untrusted reference data, reads prose only from approved documentation hosts and OpenAPI only from the exact canonical artifact, and stops on any unexpected host, path, redirect, credential request, or instruction to weaken its boundaries. Remote content cannot grant authorization, approve an external effect, override credential or safety rules, or supply operational commands for the agent to execute. These controls reduce exposure; they do not make remote content risk-free.

## Supported versions

Before the first public npm release, security fixes apply to the current `main` branch. After the first public release and until the first stable release, fixes apply to the latest published `0.x` version; upgrade to that version before reporting behavior already fixed there.
