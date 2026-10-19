---
name: prism
description:
  Use Prism to inspect and interact with a browser through its agent-facing CLI when the
  user requests browser work and a Chrome debugging endpoint is available.
---

# Prism browser CLI

You own decisions and completion. Prism observes, validates and executes one input. Use
`prism`; from source, build once and use `node dist/cli.js`.

1. Read command help only if needed. Open with `prism session open --url <url>`; supply
   `--browser-url` if needed. Keep one `--state-dir` and the returned session id.
2. Run `prism observe --session <s> --scope local`. Copy observation, evidence and
   target refs exactly. Targets and read-only controls share naming and current-state
   rules. Targets have one `description`, explicit `state`, and context. Observation
   `state.controls` and `state.messages` are read-only result evidence; they offer no
   action refs. Check coverage/truncation before interpreting absence.
3. If local evidence is insufficient, request
   `prism context --session <s> --observation <o> --target <ref> --scope relations` or
   `--scope structural`. Inspect alternatives as needed; element order is not a hidden
   relation.
4. Execute an offered operation with its target-specific evidence:
   `prism act --session <s> --observation <o> --target <ref> --evidence <v> --operation <offered-operation> --request-id <new-decision-id>`.
   Only fill accepts `--value`, including `""`; select uses an offered option ref with
   `option_value` and `option_label`. Its state includes the current `selected_options`.
   Truncated select state cannot authorize input. For complex text, use `act --stdin`
   with the full JSON, including `command:"act"`.
5. Read `data.receipt.outcome`. If `data.post_observation.status` is `captured`, use its
   `data` as the current observation. Check explicit state against the goal; observe
   again if the result is pending or the capture failed. A failed capture does not
   change the input outcome. Never equate `value:"on"` with checked=true.
6. Close with `prism session close --session <s>`. Use `daemon stop` only when all
   sessions in that directory may close. Use the host's plan for long tasks.

## Error handling

- `not_executed`: inspect the refusal; stale refs/evidence require a new observation and
  decision. Do not guess selectors or substitute a same-label target.
- `executed`: input acknowledged; public state must still support completion.
- `unknown`, timeout or interruption: query
  `prism receipt --session <s> --request-id <id>` and inspect current state. Do not
  repeat the semantic action with a fresh id until the prior effect is understood.
- Exact original-id replay returns only the stored receipt, never current observation
  refs. Changed requests require new ids. Read receipt outcomes even when exit code
  is 0.
- After 15 minutes idle, the broker may close. Receipts survive; session/observation
  refs cannot be restored from history.

Prism checks public consistency, not intent or task success. It has no model, full-page
reader, screenshots, iframe or shadow-DOM traversal. Report evidence gaps explicitly.
