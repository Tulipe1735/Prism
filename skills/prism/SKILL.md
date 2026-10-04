---
name: prism
description:
  Use Prism to inspect and interact with a browser through its agent-facing CLI when the
  user requests browser work and a Chrome debugging endpoint is available.
---

# Prism browser CLI

The external agent owns the task policy, field values and completion decision. Prism
owns observation refs and single-step browser execution. Use the installed `prism`
command; from this repository, build once and use `node dist/cli.js`.

1. Inspect `prism --help` and the relevant command help if the interface is unfamiliar.
2. Open a session with `prism session open --url <user-task-url>`. Use `--browser-url`
   if needed. Keep the returned session id and use the same `--state-dir` across
   commands.
3. Run `prism observe --session <s> --scope local`. Parse its JSON reply and copy the
   offered observation, evidence and target refs exactly.
4. If local evidence does not distinguish the requested target, use
   `prism context --session <s> --observation <o> --target <ref> --scope structural` or
   `--scope relations`. Relations exposes visible group identities. Request context for
   alternatives when necessary; do not infer hidden relations from element order.
5. Execute the chosen offered operation with
   `prism act --session <s> --observation <o> --target <ref> --evidence <v> --operation <offered-operation> --request-id <new-decision-id>`.
   Use evidence returned for this target. Only fill accepts `--value`; select uses the
   offered option ref. For complex text, send the complete command JSON through
   `act --stdin`.
6. Read the receipt outcome, then observe again after executed or unknown actions. Check
   visible state against the user's goal before reporting success.
7. Close the owned tab with `prism session close --session <s>` when finished. Use
   `daemon stop` only when all sessions in that state directory can close.

## Error handling

- `not_executed`: inspect the error; on stale evidence/reference errors, observe again
  and choose again. Do not swap in a guessed selector or another same-label target.
- `executed`: input was acknowledged, but the goal is unverified. Read the new state.
- `unknown`, interrupted act, or timeout: query
  `prism receipt --session <s> --request-id <id>` and inspect the page. Do not issue the
  same semantic action under a fresh id until the prior effect is understood.
- Repeating the exact request with its original request id returns a stored receipt.
  Changing the request while reusing the id causes a conflict. Re-observed or repaired
  decisions require a new id.
- Receipt queries can exit 0 while describing an unknown outcome. Read `ok`, `error` and
  `data.receipt.outcome`; shell exit code alone is insufficient.
- The broker may have expired after 15 minutes of inactivity. Receipts remain queryable,
  but old session and observation refs cannot be restored.

The CLI does not use a model key or perform automatic replanning. Do not place task
oracles in inputs. It validates public state consistency, not intent correctness. The
first version is control-focused and has no full-page reader, screenshots, iframe or
shadow-DOM traversal. Report a specific limitation if the task needs those capabilities.
