# ConsoleOps Agent MVP scenario catalog

Decision date: 2026-07-23  
Decision ticket: [Choose the six MVP troubleshooting scenarios](issues/04-choose-six-mvp-troubleshooting-scenarios.md)  
Status: `approved`

## Shared contract

Every scenario uses a disposable fixture, synthetic values, a visible Chrome
repair, scoped read-only MCP evidence, an intercepted typed mutation, an
approval record, a replayable trajectory, a machine-checkable oracle, and a
deterministic reset. Ask for approval (`Strict`) requests human approval for
every mutation. Approve for me (`Balanced`) policy-approves low-risk mutations
but requests approval for medium and high risk. Full Access
(`guarded-full-access`) policy-approves low- and medium-risk mutations but
still requests approval for high risk. Unknown and forbidden operations are
denied in every mode, and high-risk approval cannot be disabled.

The scenario runner is the primary end-to-end seam:

`prompt -> role handoffs -> MCP evidence -> proposed Chrome repair -> approval -> visible Chrome execution -> audit/replay -> oracle -> reset`

## S1 — Repair a GitHub Actions repository variable

- **Initial state:** A disposable repository has a failing fixture workflow
  because one non-secret Actions repository variable contains a deliberately
  incorrect synthetic value.
- **User prompt:** "Diagnose the failing fixture workflow and repair its
  non-secret configuration."
- **Evidence:** The GitHub MCP reads the failed run, job, and log output and
  identifies the referenced variable without reading or exposing secrets.
- **Chrome action:** Open the repository's Actions variable settings and replace
  the fixture value through the visible GitHub UI.
- **Approval:** Intercept the typed repository-setting mutation before the final
  save and record the approver, risk class, proposed value, and decision.
- **Oracle:** Re-run or dispatch the fixture workflow; the GitHub MCP confirms
  the expected run and job complete successfully.
- **Reset:** Restore the known-bad synthetic variable and produce a fresh
  failing run.
- **Non-goals:** Secrets, production environments, workflow-file edits, branch
  protection, repository administration, and arbitrary repositories.

## S2 — Enable a disabled GitHub fixture workflow

- **Initial state:** A known fixture workflow exists but is disabled in a
  disposable repository.
- **User prompt:** "Find why the fixture automation does not run and restore it."
- **Evidence:** The GitHub MCP confirms the workflow identity and its disabled
  state, with no unrelated repository mutation.
- **Chrome action:** Open the workflow in GitHub Actions, enable it visibly, and
  dispatch the fixture when required by the oracle.
- **Approval:** Intercept workflow enablement before the final confirmation.
- **Oracle:** The GitHub MCP confirms the workflow is enabled and a deterministic
  fixture run succeeds.
- **Reset:** Disable the same workflow and clear or ignore the prior fixture run.
- **Non-goals:** Editing workflow YAML, enabling arbitrary workflows, changing
  permissions, production deployment, or repository administration.

## S3 — Repair a Vercel preview environment value

- **Initial state:** A disposable preview project has a missing or incorrect
  non-secret synthetic environment value, causing its fixture health check to
  fail.
- **User prompt:** "Diagnose the broken preview and repair its preview-only
  configuration."
- **Evidence:** The Vercel MCP reads project, deployment, and build/runtime log
  evidence that points to the fixture key; secret values remain redacted.
- **Chrome action:** Update only the preview-scoped value in Vercel project
  settings and visibly trigger the required preview redeploy.
- **Approval:** Intercept both the setting update and redeploy as typed
  operations, grouping them in one explicit repair plan when policy permits.
- **Oracle:** Vercel reports a ready preview and the fixture endpoint returns its
  expected machine-checkable response.
- **Reset:** Restore the known-bad preview value and create a fresh failing
  preview.
- **Non-goals:** Production values, real credentials, production promotion,
  aliases, domains, DNS, billing, or arbitrary Vercel projects.

## S4 — Repair a Vercel preview build configuration

- **Initial state:** A disposable monorepo preview project has an incorrect Root
  Directory or equivalent build setting and therefore cannot build the fixture.
- **User prompt:** "Use the failed preview evidence to fix the project's build
  configuration."
- **Evidence:** The Vercel MCP reads the failed deployment and build logs and
  identifies the expected fixture directory.
- **Chrome action:** Correct the selected build setting in the visible Vercel
  dashboard and trigger a preview redeploy.
- **Approval:** Intercept the project-setting mutation and redeploy before
  execution.
- **Oracle:** The replacement preview reaches ready state and its fixture
  endpoint returns the expected response.
- **Reset:** Restore the known-bad build setting and create a fresh failed
  deployment.
- **Non-goals:** Source-code repair, production deployment, framework migration,
  domain changes, billing, or unrelated project settings.

## S5 — Repair a Supabase fixture RLS policy

- **Initial state:** A development-only fixture table has RLS enabled but lacks
  its intended narrow read policy, so the fixture role cannot read the expected
  row.
- **User prompt:** "Diagnose the fixture's authorization failure and restore the
  intended least-privilege read access."
- **Evidence:** A project-scoped, read-only Supabase MCP connection reproduces
  the denied or empty query and reads relevant advisors or logs.
- **Chrome action:** Use the visible Supabase policy editor to create the exact
  fixture-only SELECT policy for the named role and condition.
- **Approval:** Treat the security-policy change as high risk. Approval is
  mandatory in every mode and records the full proposed policy.
- **Oracle:** The intended fixture role can read the expected row while the
  unauthorized fixture role remains denied.
- **Reset:** Remove the named fixture policy and confirm the original denial.
- **Non-goals:** Production data, broad public access, write policies, bypassing
  RLS, MCP SQL mutation, schema redesign, or account administration.

## S6 — Enable a required Supabase PostgreSQL extension

- **Initial state:** A development-only fixture requires a preselected harmless
  extension such as `pg_trgm`, which is disabled; the deterministic fixture
  query therefore fails.
- **User prompt:** "Find the missing database capability and enable only what
  this development fixture requires."
- **Evidence:** The read-only Supabase MCP confirms the extension is absent and
  captures the fixture query failure.
- **Chrome action:** Enable the allow-listed extension through the visible
  Supabase dashboard.
- **Approval:** Intercept the database-capability mutation before enablement and
  show its project, schema, extension, risk class, and reversal plan.
- **Oracle:** The MCP confirms the extension is installed and the deterministic
  fixture query succeeds.
- **Reset:** Remove fixture dependencies, disable the extension, and confirm the
  original failure state.
- **Non-goals:** Production databases, arbitrary or privileged extensions,
  destructive SQL, MCP mutation, account administration, or unrelated schema
  changes.

