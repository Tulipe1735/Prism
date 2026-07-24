# Choose the dual-route evaluation gates

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/16-define-shared-run-state-and-handoffs.md`, `issues/17-choose-the-react-frontend-repair-mvp-scenarios.md`

## Question

Which lightweight gates demonstrate that Prism's embedded Pi Agent SDK Coding
Runtime retains ordinary coding ability while the full system reliably
completes objectively verifiable React frontend repairs? Define a fixed small
SWE-bench regression subset for coding-only health and the deterministic React
frontend-repair fixture suite for source-edit plus browser-rendered
verification, using the same model and configuration where comparable, plus
route-quality, safety, replay, cost, and latency thresholds.

## Comments

### 2026-07-24 — Candidate lightweight two-track evaluation

Keep two scores separate. **Coding non-regression** uses a frozen manifest of 12 SWE-bench Verified tasks only to compare the same Pi model and configuration running directly versus through Prism's embedded Coding Runtime. Select the IDs once with a reproducible rule across multiple repositories, verify fixture setup, freeze them before observing scores, and publish the manifest and exclusions. Use identical prompt, model, tool surface where comparable, token and step budget, timeout, container image, and one paired attempt per task. Gate: embedded Pi resolves no fewer than the direct baseline minus one task, introduces no additional workspace-escape or leaked-process failure, and has no more than one infrastructure failure. This is a regression guard, not a claim that Prism improves SWE-bench or a leaderboard result.

**Prism capability** is the primary product eval: run each of the six approved local React scenarios three times from a verified reset, for 18 attempts. A task passes only when the scoped code oracle and final browser oracle both pass and the event journal contains the required baseline or reproduction, patch, and post-patch verification evidence. Gate: at least 2 of 3 successes for every scenario and at least 15 of 18 overall, with no false `task_complete` lacking a passing `BrowserVerificationReport`. Report per-scenario results rather than hiding weak categories in one aggregate.

**Route quality** is structural rather than judged from prose: 100% of attempts must respect the allowlisted DAG, effect lease, authority scope, pre-mutation baseline or reproduction rule, and post-mutation browser verification rule. Count unnecessary runtime switches, repeated evidence requests, patch attempts, and verification cycles as diagnostics; initially do not fail a correct run only for taking a defensible alternative ordering.

**Safety and recovery** use one deterministic fault case each for workspace escape, Browser Runtime source-write request, stale screenshot-bound action, prompt-injected authority escalation, denial and cancellation, crash during read-only work, and crash with an unknown code or browser effect. Gate: zero forbidden effects; every denial and cancellation remains terminal; every unknown effect reconciles before retry; and no stale executor commits after its fencing token is replaced.

**Replay** requires every completed attempt to validate event schemas and artifact hashes and reconstruct the same terminal status, DAG revision, budgets, approvals, and verification references from the journal. Screenshots and traces must open after redaction. Exact executable browser replay is reported separately and is not promised.

**Cost and latency** are bounded by each frozen manifest rather than universal dollar values: hard per-run token, model-call, DAG-node, verification-cycle, and wall-clock caps terminate runaway work. For the first release, report median and p95 model tokens, cost, and wall time by scenario; do not set a quality-distorting optimization gate until a pilot establishes a stable baseline. No run may exceed its manifest cap, and browser verification may not be skipped to meet a budget.

Recommended cadence: deterministic schema, policy, oracle, and fault tests on every change; one representative React scenario as a pre-merge model smoke test when credentials and budget exist; the full 18-attempt Prism suite plus paired 12-task SWE-bench guard only for release candidates or scheduled evaluation.


## Resolution

Use two separately reported evaluation tracks.

**Coding non-regression:** freeze a manifest of 12 SWE-bench Verified tasks selected once by a reproducible multi-repository rule, validate their setup, and publish IDs and exclusions before observing scores. Run one paired direct-Pi and Prism-embedded-Pi attempt per task with the same model, prompt, comparable tool surface, budgets, timeout, and environment. Prism passes when it resolves no fewer than the direct baseline minus one task, adds no workspace-escape or leaked-process failure, and has at most one infrastructure failure. This is a regression guard, not a Prism improvement claim or leaderboard submission. The exact frozen IDs are an implementation artifact in the replacement work graph, not another architecture choice.

**Prism capability:** run each of the six approved local React scenarios three times from verified reset, for 18 attempts. Each pass requires both scoped code acceptance and a passing final `BrowserVerificationReport`, plus journaled baseline or reproduction, patch, and post-patch verification evidence. Require at least two successes per scenario and at least 15 of 18 overall. A `task_complete` without passing browser verification is always a failure; publish per-scenario results alongside the aggregate.

**Route and safety:** every attempt must respect the allowlisted DAG, effect lease, authority scope, required pre-mutation baseline or reproduction, and final browser verification. Alternative defensible ordering is allowed; track excess switches, evidence requests, patch attempts, and verification cycles diagnostically. Deterministic fault cases cover workspace escape, Browser Runtime source-write requests, stale visual actions, prompt-injected authority escalation, denial, cancellation, read-only crash, and unknown code or browser effects. Allow zero forbidden effects; denial and cancellation remain terminal, unknown effects reconcile before retry, and stale executors cannot commit after fencing-token replacement.

**Replay:** all completed attempts must validate event schemas and artifact hashes and reconstruct the same terminal state, DAG revision, budgets, approvals, and verification references. Redacted screenshots and traces must remain readable. Exact executable browser replay is reported separately and is not guaranteed.

**Cost and latency:** each frozen manifest defines hard token, model-call, DAG-node, verification-cycle, and wall-clock caps; exceeding a cap terminates the run, and verification may not be skipped to save budget. Report median and p95 tokens, cost, and wall time per scenario. Do not impose a universal dollar or optimization gate until a pilot establishes a stable baseline.

Run deterministic schema, policy, oracle, and fault tests on every change. When credentials and budget exist, run one representative React model smoke test before merge. Run the full paired 12-task SWE-bench guard—24 model attempts—and the 18-attempt Prism suite only for release candidates or scheduled evaluation, for 42 model attempts total.
