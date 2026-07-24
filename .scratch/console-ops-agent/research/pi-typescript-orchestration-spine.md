# Pi TypeScript orchestration-spine research

Research date: 2026-07-23  
Decision ticket: [Verify Pi as the TypeScript orchestration spine](../issues/03-verify-pi-typescript-orchestration-spine.md)

## Resolution

Keep `@earendil-works/pi-agent-core` as the orchestration spine. Use one
stateful `Agent` instance per role and place a small ConsoleOps coordinator
around them. Pi supplies the model loop, typed tool execution, multimodal
messages, lifecycle events, cancellation signals, and a pre-tool hook that can
await approval. ConsoleOps must own role handoffs, the static operation
registry, durable approval records, correlation identifiers, canonical
trajectory events, scenario state, and recovery policy.

Do not equate Pi's event stream or session helpers with the product's replay
contract. Pi's own documentation says it has no built-in permission system,
and its durable-harness notes still describe important recovery guarantees as
design work.

## Version and runtime

The npm registry reported:

- package: `@earendil-works/pi-agent-core`;
- latest version: `0.81.1`;
- Node engine: `>=22.19.0`;
- schema dependency used by `AgentTool`: TypeBox.

The official repository commit inspected was
[`34f3719a942ecbf3e6d23e67098f47ba2867de0a`](https://github.com/earendil-works/pi/tree/34f3719a942ecbf3e6d23e67098f47ba2867de0a).

The implementation ticket should pin an exact version and Node runtime after a
thin integration spike. The planning baseline is validated, not installed.

## Confirmed agent-loop capabilities

### Stateful agents and role isolation

`Agent` owns a system prompt, model, thinking level, tool list, transcript, and
current streaming state. Three separate instances can therefore provide hard
tool-list and prompt boundaries for Diagnoser/Router, Browser Operator, and
Auditor.

Pi does not orchestrate those roles as a workflow. The coordinator must decide
which role runs next and pass a validated handoff artifact rather than sharing
one untyped transcript.

### Tools and preflight

`AgentTool` has a TypeBox parameter schema. Pi validates arguments before
calling `beforeToolCall`. The hook can asynchronously:

- inspect the assistant message, raw tool call, validated arguments, and
  context;
- await a ConsoleOps approval gate;
- block the call with an error tool result;
- observe the active abort signal.

Tool execution receives the abort signal and can stream partial results.
`afterToolCall` can normalize or redact results before final tool events and
model-visible tool-result messages are emitted.

The default execution mode is parallel. Pi preflights calls sequentially, then
executes allowed calls concurrently. A tool can force a whole batch to
sequential mode.

For ConsoleOps, all browser actions and all mutations must be sequential.
Parallel execution is acceptable only for explicitly independent, read-only
evidence calls.

### Events

Pi emits:

- `agent_start` / `agent_end`;
- `turn_start` / `turn_end`;
- message start, streaming update, and end events;
- tool execution start, update, and end events.

`Agent.subscribe()` listeners are awaited in registration order. The Agent
class also treats assistant message completion as a barrier before tool
preflight, so `beforeToolCall` sees the tool-requesting assistant message in
agent state.

These events are sufficient inputs for a ConsoleOps trace projector, but they
lack product-level run, role, operation, risk, approval, MCP, browser
observation, artifact, handoff, and oracle semantics.

### Multimodal messages

`agent.prompt(text, images)` accepts image content. Tool results may also
contain text and image content. A browser screenshot can therefore be supplied
to the Browser Operator without a provider-specific computer-use runtime.

The browser adapter should store the artifact once, then pass the necessary
image content plus a stable artifact identifier. Redaction must happen before
the image reaches the model or durable trace.

### Context transformation

Pi applies:

`AgentMessage[] → transformContext() → convertToLlm() → provider messages`.

`transformContext` can prune or inject context and receives an abort signal.
`convertToLlm` can filter UI-only/custom app messages or translate them into
provider-visible messages. Both must return safe fallbacks rather than throw.

ConsoleOps should use custom messages for typed handoff and audit state, then
make provider visibility explicit. Approval records and secret-bearing raw
evidence should not automatically enter model context.

### Cancellation and termination

- `agent.abort()` aborts the current run.
- The active `AbortSignal` reaches context transformation, tool preflight,
  tools, hooks, and subscribers.
- A tool may return `terminate: true`; a whole batch terminates early only if
  every finalized result requests termination.
- A low-level `shouldStopAfterTurn` hook can stop after a completed turn.
- `continue()` resumes only from a compatible transcript boundary.

Cancellation is cooperative. A tool implementation must honor the signal, and
an already accepted remote mutation may not be reversible. ConsoleOps still
needs operation-specific idempotency and post-cancellation verification.

## Approval-pause conclusion

Pi can support an in-process approval pause by awaiting the ConsoleOps gate
inside `beforeToolCall`. The UI may approve, deny, or cancel the exact operation
while the run remains active.

Pi does not provide a durable, serializable pause token that survives process
restart. Therefore:

- the MVP may use an in-process pause;
- the requested operation and approval state must first be written to the
  ConsoleOps trajectory;
- restart recovery marks an in-flight approval/tool call interrupted;
- non-idempotent calls are never automatically replayed;
- a later durable workflow engine is not required for the portfolio MVP.

## Thin ConsoleOps integration contract

### Coordinator

Owns:

- run/scenario identity and lifecycle;
- role ordering and typed handoff validation;
- one Pi Agent instance per role;
- termination, escalation, and cancellation policy;
- the shared artifact index and canonical trace sink.

### Tool bridge

Owns:

- mapping Zod-validated ConsoleOps operations to Pi `AgentTool` TypeBox
  schemas;
- MCP client and browser adapter calls;
- static risk lookup;
- approval gating;
- sequential mutation enforcement;
- redaction, timeout, idempotency metadata, and normalized results.

Keep Zod as the product contract at adapter and persistence boundaries. Add one
small, tested Zod-to-Pi/TypeBox bridge or define paired schemas at the tool
edge; do not let schema definitions silently drift.

### Handoff envelope

Each role transition needs a validated artifact containing:

- run, scenario, source role, destination role, and handoff identifiers;
- concise problem/evidence/action state;
- artifact references, never duplicated secret-bearing payloads;
- allowed next responsibilities and tools;
- unresolved questions, risk state, and termination reason.

The detailed contract remains for the dedicated three-agent handoff ticket.

### Trace projector

Subscribes to Pi events and emits ConsoleOps events with stable correlation
identifiers. It must add events Pi cannot know about:

- handoff issued/accepted/rejected;
- observation/artifact captured;
- operation resolved;
- approval requested/granted/denied/expired;
- MCP request/evidence normalized;
- browser action before/after;
- verifier/oracle result;
- interruption/recovery decision.

## Current limitations and non-assumptions

- Pi explicitly has no built-in permission system; process privileges remain
  the host application's privileges.
- Pi's event payloads are runtime lifecycle events, not a versioned durable
  portfolio replay schema.
- Event subscribers can persist events, but persistence failure policy,
  artifact storage, redaction, and schema migration are application concerns.
- The package exports harness/session helpers, including JSONL facilities, but
  its durable-harness document calls the target “semi-durable” and identifies
  unfinished operation/tool recovery as open work. Do not claim transparent
  crash resume.
- Provider streams are not resumable.
- Tool cancellation is cooperative and cannot undo an external side effect.
- Pi uses TypeBox for tool schemas; the selected product boundary uses Zod.
- Pi does not define three-agent responsibility, approval modes, the risk
  registry, browser/MCP adapters, fixtures, or evaluation.
- No roadmap or design-note feature counts as implemented behavior without a
  source-level spike against the pinned package.

## Validation implications

The highest test seam remains the complete scenario runner:
natural-language prompt → three typed role handoffs → evidence/tools →
approval pause → visible repair → audit → canonical trace and oracle.

The smallest Pi-specific spike should prove:

1. a multimodal prompt reaches one Agent;
2. Zod/TypeBox-bridged tool arguments are validated;
3. `beforeToolCall` waits for an external approval promise;
4. denial blocks execution;
5. approval runs exactly one sequential mutation;
6. `abort()` reaches a waiting gate and a running cooperative tool;
7. subscribed events project to stable ConsoleOps identifiers;
8. process interruption does not automatically rerun a mutation.

## Primary sources

- [Pi Agent Core on npm](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
- [Official Pi repository](https://github.com/earendil-works/pi)
- [Agent package README at inspected commit](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/agent/README.md)
- [Agent types at inspected commit](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/agent/src/types.ts)
- [Agent implementation at inspected commit](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/agent/src/agent.ts)
- [Agent loop at inspected commit](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/agent/src/agent-loop.ts)
- [Pi durable-harness design notes at inspected commit](https://github.com/earendil-works/pi/blob/34f3719a942ecbf3e6d23e67098f47ba2867de0a/packages/agent/docs/durable-harness.md)
