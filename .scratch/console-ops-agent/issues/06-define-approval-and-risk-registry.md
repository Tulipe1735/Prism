# Define the approval and risk registry

State: `closed`  
Status: `ready-for-human`  
Label: `wayfinder:grilling`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Blocked by:
[Map MCP versus browser capabilities for GitHub, Vercel, and Supabase](02-map-mcp-versus-browser-capabilities.md),
[Choose the six MVP troubleshooting scenarios](04-choose-six-mvp-troubleshooting-scenarios.md)  
Blocks:
[Choose the trajectory, replay, and evaluation schema](07-choose-trajectory-replay-and-evaluation-schema.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

Which named operations are low, medium, high, or unknown risk across the six
MVP scenarios, and what exact approval, expiry, batching, denial, and audit
semantics should Ask for approval (`Strict`), Approve for me (`Balanced`), and
guarded Full Access modes enforce?

The registry must be deterministic and adapter-owned. Unknown operations must
never be silently reclassified by the model.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Use a versioned, adapter-owned allow-list of semantic operations. Model output
is always an untrusted proposal: no role receives raw Playwright, CDP, or
unrestricted browser-mutation authority. Only `BrowserActionExecutor` holds
the browser capability, and only an exact registered semantic operation may
reach a server-changing action.

#### Registry states and enforcement

A proposed operation resolves to one of three registry states:

- **Registered:** an exact operation, parameter schema, target restriction,
  precondition, redaction rule, risk class, and audit policy exist.
- **Unknown:** no exact entry matches. Deny before execution and emit a
  redacted `RegistryMiss`; neither a model nor an inline human approval may
  reclassify it.
- **Forbidden:** the operation or target is intentionally excluded. Emit
  `PolicyDenied` and terminate without offering registry review or override.

An unknown proposal may return once to the Diagnoser to seek an already
registered alternative. If none exists, block the problem and show the
`RegistryMiss` in a non-executable review queue. Adding support later requires
a registry change with a schema, risk class, target restrictions, redaction,
preconditions, oracle, reversal/reset behavior, and tests.

Production targets, secrets, billing, domains or DNS, account administration,
arbitrary projects/workflows/extensions, destructive SQL, broad RLS access,
and security weakening are forbidden in every mode. Risk is a property of the
operation plus its constrained target: an otherwise registered preview
operation aimed at production resolves to forbidden, not merely high risk.

If evidence shows that the root cause is source code rather than a console
operation, the Diagnoser may emit a typed `ExternalCodeHandoff` with the
problem node, evidence references, repository identity, constraints, and
non-goals. The user may manually send that package to a coding agent.
ConsoleOps never launches the coding agent or modifies code; automatic code
repair remains post-MVP and a registry miss never becomes a code-edit request.

#### MVP operation registry

| Risk | Semantic operation | Required constraints |
| --- | --- | --- |
| Low | `browser.observe_scoped_target` | Bound disposable target; navigation, screenshots, and locator observations only |
| Low | `github.read_fixture_workflow_evidence` | Allow-listed fixture repository; redacted, read-only MCP evidence |
| Low | `vercel.read_fixture_preview_evidence` | Allow-listed preview project; redacted, read-only MCP evidence |
| Low | `supabase.read_fixture_database_evidence` | Allow-listed development project; redacted, read-only MCP evidence |
| Low | `scenario.verify_oracle` | Machine-checkable read against the bound fixture |
| Low | `github.dispatch_fixture_workflow` | One named allow-listed fixture workflow; bounded to one dispatch |
| Medium | `github.set_fixture_actions_variable` | Named non-secret variable; synthetic allowed values; repair or reset |
| Medium | `github.set_fixture_workflow_enabled` | Named fixture workflow only; repair or reset |
| Medium | `vercel.set_fixture_preview_env` | Preview scope only; synthetic non-secret key/value; repair or reset |
| Medium | `vercel.set_fixture_build_setting` | Named Root Directory/build field on the fixture project; repair or reset |
| Medium | `vercel.redeploy_fixture_preview` | One preview deployment; no production promotion or alias |
| High | `supabase.create_fixture_rls_select_policy` | Exact table, role, name, and least-privilege predicate |
| High | `supabase.remove_fixture_rls_select_policy` | Exact named fixture policy; reset only |
| High | `supabase.enable_allowlisted_extension` | Named development project, schema, and allow-listed harmless extension |
| High | `supabase.disable_allowlisted_extension` | Exact allow-listed extension after dependency precheck; reset only |

The registry contains no generic click, type, save, SQL, deploy, settings,
policy, or extension mutation. Changed operation names, parameters, targets,
accounts, projects, environments, or preconditions fail closed.

#### Three permission modes

Expose three user-facing permission modes. Internally, the third is
`guarded-full-access`; its UI label may be **Full Access** only with a visible
statement that hard safety limits remain active.

| Operation | Ask for approval (`Strict`) | Approve for me (`Balanced`) | Full Access (`guarded-full-access`) |
| --- | --- | --- | --- |
| Read-only observation | Automatic | Automatic | Automatic |
| Low-risk mutation | Human approval | Policy approval | Policy approval |
| Medium-risk mutation | Human approval | Human approval | Policy approval |
| High-risk mutation | Human approval | Human approval | Human approval |
| Unknown operation | Deny | Deny | Deny |
| Forbidden operation | Deny | Deny | Deny |

Every policy-approved mutation still creates an `ApprovalRecord` with
`decisionBy: policy`; every read emits a policy-resolution audit event. No
operation may downgrade its own risk. High-risk approval, registry
enforcement, production checks, and forbidden-operation denial cannot be
disabled by any mode.

#### Approval scope and validity

The MVP supports `approvalScope: single` only:

- one `OperationProposal` authorizes one server-changing operation;
- the UI may preview a longer repair sequence but approves only the next step;
- evidence and preconditions refresh before every later mutation;
- no approve-all, wildcard, reuse, or batched approval exists;
- high-risk operations are always isolated.

Batching is a future orthogonal capability, not a fourth permission mode. A
future `bounded_plan` scope would require one immutable same-problem,
same-target ordered plan, per-step hashes and preconditions, stop-on-drift,
and exclusion of high, unknown, and forbidden operations. It is not part of
the MVP.

Approval is one-time and bound to the registry version, exact operation,
normalized parameters, active problem, target, risk class, and observed
precondition. Keep `decidedAt` to prove ordering, but do not use a fixed
`expiresAt` in the MVP. Record `consumedAt`, or `invalidatedAt` and the reason.
State drift, navigation to another target, parameter change, interruption, or
process restart invalidates the decision.

#### Denial, cancellation, and recovery

Denying an operation:

- executes no mutation;
- writes `ApprovalRecord(decision: denied)`;
- marks the active problem `blocked` with `approval_denied`;
- terminates that transaction;
- does not let the Diagnoser propose a semantically equivalent workaround
  unless the user explicitly requests a fresh diagnosis.

Cancelling a run stops the active problem and all remaining DAG nodes.
Unstarted approvals and operations become invalid. If a mutation may already
have started, the Auditor records the latest observable state as `passed`,
`failed`, or `indeterminate`; the system neither assumes rollback nor replays
the operation.

The cancelled DAG is frozen as a redacted audit snapshot. A new run combines
that snapshot, the user's current problem, and freshly observed actual state
to construct a new DAG. Old statuses are revalidated, irrelevant or stale
nodes are omitted, lineage uses `derivedFromRunId` and `originProblemId`, and
old approvals never transfer.

#### Audit durability

Before mutation, the trace must durably contain:

- run, scenario, problem, handoff, and proposal identifiers;
- registry version, operation name, risk class, and permission mode;
- redacted preview plus target, operation, parameter, and precondition hashes;
- decision, decision source, decision time, and approval constraints.

Failure to persist this pre-action record denies execution. After execution,
the trace records action start/finish or error, approval consumption,
before/after artifact references, observed result, and `AuditVerdict`.

If a mutation may have occurred but post-action persistence fails, stop the
remaining DAG, mark the result `indeterminate`, do not retry or roll back, and
require fresh observation on recovery. Unknown, forbidden, denied, cancelled,
interrupted, and policy-approved outcomes use the same trace. Sensitive values
are redacted or represented only by hashes and protected artifact references.

#### LLM-planned deterministic reset

Each scenario owns a versioned `ScenarioFixtureManifest` defining the exact
disposable target, known-bad baseline, allowed reset primitives, baseline
hash, and machine-checkable oracle. The target baseline remains fixed so runs
are comparable, but the Diagnoser may act as a `ResetPlanner`: it combines the
manifest with freshly observed state and proposes a dependency-ordered
`ResetPlan`.

The LLM may choose how to reach the fixed baseline, but it cannot execute the
plan, change the baseline, weaken the oracle, or introduce new primitives.
Each reset step must match the static registry and execute one mutation at a
time under the same three-mode matrix. High-risk reset steps always require
human approval; unknown and forbidden steps block.

Reset lifecycle is separate from the diagnostic `ProblemGraph`. A reset is
initiated by the user or test runner, fully audited, and complete only when
the fixed baseline oracle passes. Failure marks the fixture `dirty`, stops the
reset, and prevents a new scenario run. Allowing an LLM to invent new failure
baselines is future scenario authoring, not MVP reset behavior.
