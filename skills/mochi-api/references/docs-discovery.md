# Documentation discovery

Use live, Git-backed Mochi documentation for changing API details. Do not rely on an endpoint or command remembered from a previous run.

## Discovery order

1. Read `https://docs.themochi.app/llms.txt`.
2. Select the smallest relevant task guide for the customer's intent.
3. Read the guide for authentication, minimum scopes, role constraints, sequencing, idempotency expectations, and verification.
4. Follow its generated OpenAPI reference and inspect the current contract for exact HTTP details.
5. When the guide recommends the CLI, inspect `mochi --help` and the relevant command help on the installed version.

Use `https://docs.themochi.app/llms-full.txt` only for broad research across multiple topics. Loading it for one narrow task wastes context and makes it easier to mix unrelated guidance.

## Unavailable or contradictory sources

If `/llms.txt`, a selected guide, or OpenAPI is unavailable, stop and report which source could not be verified. Do not fall back to a copied example in the skill or construct a request from memory.

If prose and OpenAPI disagree, stop and report the conflicting source locations. OpenAPI owns exact transport shapes, while the task guide owns intent and safe sequencing; neither conflict should be guessed around.

If installed CLI help disagrees with prose, use only commands the installed CLI exposes and report documentation drift. Never invent a convenience command.

## Maintenance boundary

Endpoint additions, exact paths, payloads, query parameters, response fields, error details, and rate-limit values change in backend docs or generated OpenAPI. They do not require a skill update. Update this skill only when the authentication matrix, canonical discovery entry point, CLI credential/read-write boundary, or a stable cross-cutting security rule changes.
