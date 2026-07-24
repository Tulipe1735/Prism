# Prism future dashboard adapters

Status: `deferred`
Origin: valuable constraints absorbed from the superseded ConsoleOps plan
Implementation status: `not authorized`

GitHub, Vercel, and Supabase dashboard repair may become a later Prism adapter family after the local React repair system and R1–R13 release evidence are complete. This is not an active scenario catalog, implementation graph, or extension of M1/M2.

The future adapters reuse Prism Orchestrator, Browser Runtime, ActionBroker, event journal, artifact store, approval records, deterministic oracles, and recovery semantics. They do not restore the former Diagnoser, Browser Operator, and Auditor product model, add another autonomous runtime, or allow the browser worker to edit source.

## Promotion gate

Before any dashboard scenario becomes an implementation ticket:

1. open a new scoped design decision after the React release baseline exists;
2. revalidate vendor MCP and dashboard capabilities against current primary documentation;
3. provision a disposable repository, preview project, or development database;
4. freeze a synthetic known-bad baseline, deterministic reset, and machine-checkable oracle;
5. register exact semantic operations, targets, parameters, preconditions, redactions, risks, and approvals;
6. demonstrate cleanup without production accounts, secrets, billing, or irreversible state.

## Reusable adapter contract

### Evidence and authority

- Vendor MCP connections are project-scoped, minimally enabled, and read-only by default.
- MCP supplies structured diagnosis and independent before and after verification. It is not an authorization boundary, and a discovered tool is not automatically allowed.
- Browser input remains a typed ActionBroker proposal. Neither UI-TARS nor an MCP tool receives unrestricted browser, shell, repository, or filesystem authority.
- Page content, screenshots, DOM, accessibility data, console output, network bodies, and MCP responses are untrusted observations and cannot widen tools or policy.

### Semantic operation registry

Every persistent effect must match a versioned, adapter-owned registry entry containing:

- operation name and parameter schema;
- allowlisted account, repository or project, environment, and target;
- expected precondition and intended postcondition;
- redaction and artifact policy;
- risk class and approval requirement;
- deterministic oracle and reversal or reset primitive.

Unknown operations fail closed and emit a registry miss. Forbidden operations terminate without an override path. Generic `click`, `type`, `save`, `deploy`, SQL, settings, policy, extension, or arbitrary JavaScript operations are never registered as persistent effects.

### Approval and recovery

- An approval is single-use and binds the registry version, operation digest, normalized parameters, active DAG node, target, risk, observation, and precondition.
- State drift, changed parameters, navigation to another target, interruption, or process restart invalidates the approval.
- The journal must durably record the redacted proposal and approval decision before execution. Persistence failure denies the action.
- Denial and cancellation perform no new mutation and terminate the current transaction.
- An unknown or possibly partial effect is never blindly retried. Prism first observes actual state, then appends a reconciliation, compensation, or human-review node.
- Reset is a separately audited workflow and completes only when its fixed baseline oracle passes. A failed reset marks the fixture dirty.

### Browser evidence

- Prefer a unique semantic target; use hybrid visual grounding when it adds confidence.
- Coordinate actions are a fallback and bind to the exact screenshot, viewport, device-pixel ratio, tab, URL, and page-state hash.
- Navigation, resize, scrolling, a newer observation, or target ambiguity makes a visual action stale.
- Capture localized before and after evidence for every persistent effect.
- Playwright and UI-TARS traces are supplementary forensic artifacts. Exact executable replay of a changing external dashboard is not promised.

## Candidate adapter scenarios

These six scenarios are retained as future inputs, not approved work.

| Adapter | Synthetic failure | Evidence channel | Visible browser repair | Oracle and reset | Risk |
| --- | --- | --- | --- | --- | --- |
| GitHub | A non-secret Actions repository variable has the wrong fixture value | Project-scoped GitHub MCP reads the failed workflow, job, and logs | Change only the named synthetic variable | A fixture workflow succeeds; reset restores the wrong value and fresh failure | Medium |
| GitHub | A named disposable workflow is disabled | GitHub MCP confirms workflow identity and state | Enable only that workflow and optionally dispatch it | MCP confirms enabled state and successful fixture run; reset disables it | Medium |
| Vercel | A preview-only synthetic environment value is missing or wrong | Project-scoped Vercel MCP reads deployment, build, and runtime evidence | Update only the preview value and trigger one preview redeploy | Preview becomes ready and fixture endpoint passes; reset restores the bad value | Medium |
| Vercel | A disposable preview has the wrong Root Directory or build setting | Vercel MCP reads failed build evidence | Correct the named build field and redeploy preview | Replacement preview and fixture endpoint pass; reset restores the bad setting | Medium |
| Supabase | A development fixture table lacks one narrow read policy | Read-only, project-scoped Supabase MCP reproduces denial and reads advisors or logs | Create the exact fixture-only SELECT policy | Intended role reads the row while unauthorized role remains denied; reset removes the policy | High |
| Supabase | A harmless allowlisted development extension required by a fixture is disabled | Read-only Supabase MCP confirms extension state and fixture-query failure | Enable only the named extension | Extension and fixture query pass; reset removes dependencies and disables it | High |

## Permanently forbidden initial surfaces

- production accounts, deployments, databases, or customer data;
- secrets, service-role keys, tokens, credential screenshots, or secret-value editing;
- billing, purchases, domains, DNS, ownership transfer, or organization and account administration;
- repository deletion, visibility changes, branch or ruleset weakening, or arbitrary source pushes;
- production promotion, aliases, real environment secrets, or arbitrary deployments;
- destructive SQL, broad RLS access, database-password rotation, project pause or deletion, arbitrary extensions, or security weakening;
- uploads, downloads, cross-origin data movement, or arbitrary script evaluation without a separately approved capability design.

## Historical decisions intentionally not carried forward

- Chrome interaction is not mandatory for every Prism task.
- Vendor MCP is not part of the React MVP.
- The former three-agent role split is replaced by one Orchestrator with sibling Coding and Browser runtimes.
- The former Next.js operator and replay interface is not an approved Prism milestone.
- The former I1–I8 ConsoleOps graph must not be published or implemented.

## Historical source note

This document is the durable Prism summary of the removed ConsoleOps planning directory. The detailed external capability research was dated 2026-07-23 and must be refreshed before implementation because vendor MCP and dashboard surfaces change.
