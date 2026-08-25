# Release protection checklist

Publishing is forbidden until a maintainer has verified every control below. The workflow file documents the intended release path; it does not configure GitHub rulesets, environments, npm trusted publishing, or account permissions by itself.

## One-time repository controls

- [ ] The repository is public and its canonical slug is exactly `TheMochiApp/mochi-agent`.
- [ ] A GitHub ruleset protects `v*` tags, restricts tag creation to release maintainers, applies to administrators, and has no bypass actor or admin bypass.
- [ ] The GitHub `production` environment requires approval from a reviewer other than the person dispatching the release, has “prevent self-review” enabled, has no administrator bypass, and restricts deployment to protected `v*` tags.
- [ ] npm trusted publishing for `@themochiapp/cli` is configured with organization `TheMochiApp`, repository `mochi-agent`, workflow filename `publish.yml`, environment `production`, and only the `npm publish` action allowed.
- [ ] The npm package and organization contain no automation token for this workflow. GitHub repository, organization, and `production` environment secrets contain no npm publish token or `NODE_AUTH_TOKEN`.

## Every release

- [ ] CI and the live OpenAPI contract are green on the release commit.
- [ ] `package.json` has the intended version and the protected annotated or lightweight tag is exactly `v<package version>` at that commit.
- [ ] The maintainer dispatches **Publish npm package** with that existing tag and does not approve their own production deployment.
- [ ] The verification job succeeds before the production reviewer approves the isolated OIDC publish job.
- [ ] The published package is public, has npm provenance, and contains only the five-file release allowlist reported by the workflow.

The verification job executes repository code without OIDC permission, builds a scripts-disabled tarball, and records its SHA-256. The protected publish job has no checkout and executes no repository or dependency scripts; it receives only the verified tarball and checksum before requesting the short-lived npm OIDC identity.
