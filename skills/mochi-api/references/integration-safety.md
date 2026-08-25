# Integration safety

The Mochi CLI is read-only. Do not invent a write command. Use the current task guide and OpenAPI when a separately approved direct API integration must mutate data.

## Bounded write plan

Before execution, provide:

- the selected organization and intended resource;
- the exact current operation from OpenAPI;
- minimum scopes and any role floor or organization-principal rule;
- the expected prior state and intended new state;
- current idempotency behavior and how a retry preserves one intended action;
- partial-failure handling and the stop condition for ambiguous outcomes;
- explicit approval required before the mutation;
- post-write verification; and
- rollback or compensating action when the current guide supports one.

Read the resource before planning and again for verification. If state changed between approval and execution, stop and request a revised plan. Do not broaden scope, overwrite a conflict, or continue later steps after an unverified write.

## Side-effect boundaries

An integration request alone is not approval for an outbound message, automation activation, flow run, lead-stage change, contact overwrite, or suppression behavior. Name each effect and obtain explicit user intent for it. Prefer inactive definitions and approved test resources when the current task guide offers them.

Never retry a mutation unless current documentation defines safe idempotency behavior for that operation. Never generate a new retry identity merely because a response was lost. For an ambiguous provider outcome, stop and escalate with sanitized request metadata.

## Agent and data boundary

Do not place credentials, authorization material, customer payloads, contact values, message content, cursors, or provider data in prompts, logs, screenshots, source control, or support records. Report only the sanitized fields the current failure guide allows.

If current docs or OpenAPI cannot establish the write contract, produce a blocked plan that names the missing evidence. Do not execute from remembered API details.
