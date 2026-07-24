# Define the three-agent handoff contract

State: `closed`  
Status: `ready-for-human`  
Label: `wayfinder:grilling`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Blocked by:
[Choose the TypeScript Chrome-control substrate](01-choose-typescript-chrome-control-substrate.md),
[Verify Pi as the TypeScript orchestration spine](03-verify-pi-typescript-orchestration-spine.md)  
Blocks:
[Choose the trajectory, replay, and evaluation schema](07-choose-trajectory-replay-and-evaluation-schema.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

What information and authority belong to the Diagnoser/Router, Browser
Operator, and Auditor, and what typed artifacts must cross each handoff so the
roles improve safety and evaluation rather than becoming three conversational
personas?

The resolution must define ownership, allowed tools, termination conditions,
failure/escalation behavior, and the minimum shared state.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Use three authority-separated Pi agents behind a deterministic ConsoleOps
coordinator. The coordinator owns workflow state and policy enforcement; it is
runtime infrastructure, not a fourth conversational agent.

#### Role ownership and authority

**Diagnoser/Router**

- Owns problem decomposition, dependency discovery, diagnosis, and selection
  of the evidence needed to justify a repair.
- May use scoped, read-only official MCP tools, scenario contracts, the static
  operation-risk registry, and referenced trace artifacts.
- Produces or updates problem nodes and emits one `DiagnosisBundle` for the
  active problem.
- Cannot operate Chrome, mutate a console, approve an operation, or declare a
  repair successful.
- Terminates its turn by emitting a diagnosis, marking the problem blocked, or
  escalating insufficient or contradictory evidence.

**Browser Operator**

- Owns visible Chrome observation, navigation, target confirmation, proposal,
  and execution through the single Chrome adapter.
- May use screenshots and locator-first browser observations. It receives MCP
  evidence by reference rather than calling MCP tools directly.
- Emits an exact `OperationProposal` before mutation and may execute only the
  proposal authorized by the coordinator's risk and approval gate.
- Cannot broaden the diagnosed scope, approve its own proposal, perform an
  unrecorded mutation, or declare success.
- Terminates its turn with a proposal, a single `ExecutionResult`, or a typed
  blocked/escalated result.

**Auditor**

- Owns independent post-execution verification against the approval record,
  trace, MCP evidence, scenario oracle, and observed latest state.
- May use read-only official MCP tools, trace artifacts, and deterministic
  oracle results.
- Emits an `AuditVerdict` of `passed`, `failed`, or `indeterminate`, and may
  stop or escalate the transaction.
- Cannot mutate Chrome, approve a proposal, order a repair, perform rollback,
  or declare that an unverified state is safe.
- On failure, returns control—not console state—to the Diagnoser with the
  latest observed state.

**Deterministic ConsoleOps coordinator**

- Owns the durable problem graph, lifecycle transitions, handoff validation,
  active-node selection, static risk lookup, approval binding, artifact
  references, attempt limits, cancellation, and scenario reset.
- Rejects role outputs that violate the schema, authority boundary, active
  problem, approved operation, or expected preconditions.

#### Problem DAG and serial execution

Store discovered problems in a persistent `ProblemGraph` DAG. Each node has at
least `problemId`, `title`, `status`, `dependsOn`, optional
`parentProblemId`, evidence and diagnosis references, creator, and termination
reason. The coordinator validates acyclicity and derives reverse `blocks`
links.

Only one problem may be `active`. A node becomes eligible only after every
`dependsOn` node has passed. A multi-problem request therefore produces a DAG
of compact finding summaries, but expands only the selected ready node into a
full diagnosis. Newly discovered non-blocking problems join the graph; a new
blocking or safety-critical problem pauses the active transaction and
escalates for human direction.

Execution stays serial:

`active diagnosis -> visible Chrome inspection -> operation proposal -> risk
and approval gate -> one visible mutation -> independent audit -> terminal
verdict or fresh diagnosis`

Each approved MVP scenario run still has one intended fault. A session may
process multiple scenario runs sequentially, never concurrently.

#### Minimum typed handoff protocol

All handoff artifacts share `schemaVersion`, `runId`, `scenarioId`,
`problemId`, `handoffId`, producer role, timestamp, and artifact references.
The minimum protocol is:

- `RunContext`: target identity, lifecycle state, active problem, graph
  version, attempt count, and compact queue summaries.
- `ProblemGraph`: dependency nodes and their durable lifecycle states.
- `DiagnosisBundle`: active node, `dependsOn`, resolved dependency summaries,
  MCP evidence references, suspected cause, constraints, confidence,
  permitted operation kinds, unresolved questions, and non-goals.
- `OperationProposal`: exact visible Chrome action, target, expected current
  value or precondition, intended value, risk class, expected result, oracle,
  and deterministic reset reference.
- `ApprovalRecord`: `approved` or `denied`, `decisionBy` of `human` or
  `policy`, Strict, Balanced, or guarded Full Access mode, `decidedAt`,
  operation and precondition hashes, problem and target identity, risk class,
  and one-time consumption or
  invalidation data.
- `ExecutionResult`: the observed action, before/after artifact references,
  browser result, and any error.
- `AuditVerdict`: `passed`, `failed`, or `indeterminate`, oracle evidence,
  latest known state, and termination or escalation reason.

Credentials, complete browser pages, raw MCP payloads, and full chat histories
do not cross role boundaries. They remain outside prompts and are represented
only by scoped references in the trace store. Each role receives the minimum
state for the active problem, preventing context growth as the DAG expands.

#### Approval validity

Approval is one-time and bound to the exact operation, active problem, target,
risk class, and observed precondition. Keep `decidedAt` to prove that the
decision preceded execution, but do not add a fixed `expiresAt` in the MVP.
Any operation, account, project, environment, target, or precondition change
invalidates the record. Record `consumedAt`, or `invalidatedAt` and an
invalidation reason. A changed proposal requires a new decision.

#### Failure, retry, reset, and termination

- If the Browser Operator cannot identify the exact target or confirm the
  expected state, it performs no mutation. It may re-observe once, then
  returns `blocked`.
- Login prompts, permission failures, target mismatches, unexpected
  destructive choices, policy violations, or evidence contradictions pause
  and escalate immediately.
- A `failed` or `indeterminate` audit never triggers a blind retry. It creates
  or updates a finding and returns the latest actual state to the Diagnoser.
- Any corrective mutation is a new transaction with a new proposal,
  precondition check, risk decision, and approval when required.
- The Auditor never rolls back. Deterministic fixture reset belongs to the
  coordinator; a repair rollback is itself a separately proposed and approved
  operation.
- Each problem node permits at most two approved mutations: the initial repair
  and one re-diagnosed correction. A second unsuccessful audit marks the node
  `escalated` and stops automatic work.
- A transaction also terminates on verified success, approval denial,
  approval invalidation, user cancellation, policy rejection, reset failure,
  or violation of an authority or schema invariant.
