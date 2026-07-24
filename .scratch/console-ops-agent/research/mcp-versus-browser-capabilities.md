# MCP versus browser capability audit

Research date: 2026-07-23  
Decision ticket: [Map MCP versus browser capabilities for GitHub, Vercel, and Supabase](../issues/02-map-mcp-versus-browser-capabilities.md)

## Resolution

Use each vendor's official MCP server as a scoped evidence and verification
channel. Keep the Browser Operator responsible for a selected set of visible
console repairs that are absent from the enabled MCP inventory or deliberately
withheld from it. The benchmark must use disposable GitHub repositories,
Vercel preview projects, and Supabase development projects only.

“Browser-only” below means unavailable through the current official MCP tool
inventory selected for the MVP, or intentionally unavailable because the MCP
connection is configured read-only. It does not claim that no vendor REST API
or CLI exists.

## Cross-console policy

- Pin every connection to one fixture repository/project when the server
  supports scoping.
- Enable only the tool groups needed by the scenario.
- Default evidence connections to read-only.
- Do not expose secrets, billing, organization administration, production
  targets, or broad account-management tools.
- A browser repair must still cross the same static operation-risk registry as
  an MCP mutation.
- MCP evidence is independently captured before and after the browser action.
- The success oracle must be machine-checkable and must not rely only on a
  screenshot saying the UI looks correct.

## GitHub

### Confirmed official MCP capabilities

The official GitHub MCP server supports granular toolsets and individual-tool
allow-lists. Its read-only mode removes write tools even if they were otherwise
requested.

Useful structured evidence includes:

- repository files, trees, branches, commits, tags, and blame;
- issues, pull requests, reviews, and repository collaborators;
- Actions workflows, workflow runs, jobs, artifacts, and job logs;
- code-scanning, secret-scanning, Dependabot, and advisory findings when their
  toolsets and permissions are enabled.

Available mutations include, depending on enabled tools and OAuth scopes:

- creating branches and creating, updating, pushing, or deleting files;
- issue, pull-request, review, label, and project mutations;
- dispatching, rerunning, or cancelling GitHub Actions workflow runs.

### Browser-owned MVP surface

The current official inventory does not expose repository Actions
secrets/variables or the relevant repository Actions settings as normal tools.
Those console surfaces are therefore suitable for visible browser repair:

- add/update/remove a non-secret repository Actions variable;
- enable a manually disabled fixture workflow;
- inspect the rendered Actions run and settings state for human-readable
  evidence.

Do not use real secrets. Secret-scanning tools report findings; they are not a
safe secret-value management channel.

### Excluded/high-risk surfaces

- repository deletion, visibility changes, ownership transfer, organization
  administration, billing, deploy keys, real credentials, and production
  environment protection;
- arbitrary source pushes as the repair mechanism for the initial benchmark;
- branch/ruleset weakening or security-feature disabling.

## Vercel

### Confirmed official MCP capabilities

Vercel's official remote MCP server is OAuth-based and currently documented as
Beta. Project-specific URLs can bind team and project context.

Useful authenticated tools include:

- list teams and projects and get project metadata;
- list deployments and get deployment status/metadata;
- retrieve build logs and filtered runtime logs;
- obtain/fetch an authenticated Vercel deployment URL;
- deploy the current project to Vercel.

The public/authenticated inventory also includes documentation search and
domain availability/price checks. It exposes a domain-purchase operation; that
is a billing mutation and is excluded from the MVP.

### Browser-owned MVP surface

The documented tool inventory does not expose general project environment
variable editing or the normal dashboard controls for build/root-directory
configuration. Suitable visible browser repairs are:

- add or correct a synthetic, non-secret preview environment variable and
  trigger a preview redeploy;
- correct a deliberately wrong preview project's Root Directory or build
  setting and redeploy.

MCP supplies the failed deployment/build/runtime evidence and independently
verifies the next deployment. Browser interaction remains the actual repair.

### Excluded/high-risk surfaces

- production promotion, production aliases, domain purchase/transfer, DNS,
  billing, team/member management, production environment values, and real
  secrets;
- broad CLI delegation through a generic tool;
- deploying arbitrary user code as an unreviewed side effect.

## Supabase/PostgreSQL

### Confirmed official MCP capabilities

Supabase's official remote MCP server supports project scoping, feature-group
selection, and `read_only=true`. Supabase explicitly recommends development or
test projects rather than production.

Available groups include:

- Database: list tables/extensions/migrations, apply migrations, execute SQL;
- Debugging: retrieve API/Postgres/Edge/Auth/Storage/Realtime logs and security
  or performance advisors;
- Development: project URL, publishable/legacy anon keys, and generated
  TypeScript types;
- Edge Functions: list/get/deploy;
- Account management: project/org read plus create/pause/restore and cost
  operations (disabled by project scoping);
- experimental paid branching operations;
- Storage configuration, disabled by default.

Because the unscoped server is broad, the MVP must use `project_ref`, enable
only required groups, and prefer `read_only=true`.

### Browser-owned MVP surface

Supabase MCP can perform powerful database writes, so browser use cannot be
made meaningful merely by pretending SQL is unavailable. The benchmark should
intentionally keep MCP read-only and choose console settings that are not in
the enabled inventory, for example:

- create or correct a fixture-only RLS policy through the dashboard policy
  editor while read-only MCP queries and advisors supply evidence;
- enable a safe fixture database extension from the dashboard while the MCP
  connection lists extensions and verifies the state;
- as a fallback, correct a development Auth redirect or exposed-schema fixture
  after proving that its external browser oracle is inexpensive and reliable.

The scenario ticket should choose two of these only after fixture cost and
reset reliability are confirmed. Do not use `get_publishable_keys` unless a
later scenario proves it necessary; even publishable keys should be redacted
from trajectories.

### Excluded/high-risk surfaces

- production data, destructive SQL, dropping schemas/tables, database password
  rotation, project pause/restore/create, cost confirmation, branch merge or
  deletion, Edge Function deployment, organization management, and Storage
  configuration;
- service-role keys, access tokens, real user data, or screenshots containing
  credential values;
- enabling arbitrary extensions or changing network/security controls.

## Capability and risk summary

| Console | MCP evidence suitable for MVP | MCP writes present but normally disabled | Browser repair candidates | Explicit exclusions |
| --- | --- | --- | --- | --- |
| GitHub | workflow/run/job status and logs; repo content and history | workflow dispatch/rerun/cancel; repo and collaboration mutations | non-secret Actions variable; enable fixture workflow | secrets, repo deletion/transfer, security weakening, production environments |
| Vercel | project/deployment metadata; build/runtime logs; protected preview fetch | deploy; domain purchase exists and is forbidden | preview env value; root/build setting; preview redeploy | production promotion/aliases, billing/domains/DNS, real secrets |
| Supabase | tables/extensions/migrations; logs; advisors; project URL | SQL/migrations, Edge deploy, account and branch mutations | fixture RLS policy; safe fixture extension | production data, destructive SQL, account/cost/branch/storage administration, secret keys |

## Candidate hybrid benchmark families

These are inputs to the human scenario decision, not a closed scenario catalog:

1. GitHub Actions fails because a non-secret repository variable is wrong:
   MCP reads workflow/job evidence; Chrome repairs the variable; MCP reruns or
   verifies the successful fixture workflow.
2. A fixture GitHub workflow is disabled:
   MCP identifies workflow state and source; Chrome enables it; MCP dispatches
   and verifies a run.
3. A Vercel preview deployment lacks a synthetic public environment value:
   MCP diagnoses build/runtime logs; Chrome repairs the preview-only value and
   redeploys; MCP verifies the deployment.
4. A Vercel preview has a deliberately wrong Root Directory/build setting:
   MCP diagnoses build logs; Chrome repairs dashboard configuration; MCP
   verifies the next preview.
5. A fixture Supabase table has no intended read policy:
   read-only MCP queries/advisors diagnose the RLS denial; Chrome creates the
   narrow fixture policy in the dashboard; MCP and the fixture query verify it.
6. A harmless Supabase development extension required by a fixture is off:
   MCP lists extension state/log evidence; Chrome enables it; MCP verifies the
   extension and fixture query.

Each must define a deterministic reset and use synthetic fixture values.
Auth redirect and exposed-schema variants remain fallbacks, not MVP defaults.

## Approval implications

- Structured reads are low risk only after target scoping and redaction.
- Non-secret fixture setting mutations are at least medium risk and require
  approval in Balanced mode.
- Any secret/security/billing/production/account/destructive operation is high
  or forbidden; the initial adapters should not register most of them at all.
- A server-advertised tool is not automatically allowed. The static adapter
  registry is an allow-list over discovered MCP tools.
- Tool discovery changes must fail closed and produce an audit event.

## Primary sources

- [Official GitHub MCP server](https://github.com/github/github-mcp-server)
- [GitHub MCP server configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md)
- [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
- [Vercel MCP tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools)
- [Supabase MCP server](https://supabase.com/docs/guides/ai-tools/mcp)
- [Supabase API security and RLS](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Postgres extensions](https://supabase.com/docs/guides/database/extensions)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

Source snapshots inspected:

- GitHub MCP server commit
  [`eb088dfe9d854dab6453a8d4ae5871a5ced20974`](https://github.com/github/github-mcp-server/tree/eb088dfe9d854dab6453a8d4ae5871a5ced20974)
- Vercel MCP documentation last-updated labels visible during research:
  2026-01-30 for the overview and 2026 documentation for the tools reference.
