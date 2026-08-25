# Security policy

## Report privately

Use [GitHub's private security advisory form](https://github.com/TheMochiApp/mochi-agent/security/advisories/new) for suspected vulnerabilities in this CLI. Include the affected version, platform, impact, and minimal reproduction. If the form is unavailable, contact Mochi support and ask for a private security-reporting channel before sharing technical details.

Do not open a public issue for a vulnerability before it is triaged. Never include access tokens, refresh tokens, authorization codes, PKCE verifiers, credential files, unredacted HTTP headers, customer data, or secrets in GitHub issues, advisory text, chat, terminal transcripts, screenshots, or logs. Redact those values even in a private report; Mochi does not need live credentials to investigate.

If a live credential may have been exposed, revoke it with `mochi auth logout` or Settings → Developers and notify the affected organization administrator immediately.

## Supported versions

Until the first stable release, security fixes apply to the latest published `0.x` version only. Upgrade to the newest package before reporting behavior already fixed there.
