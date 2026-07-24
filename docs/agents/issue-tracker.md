# Issue tracker: Local Markdown

Issues and PRDs for this project live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from
  `01`
- `State:` records whether an issue is `open` or `closed`
- `Status:` records its triage state; see `triage-labels.md`
- `Assignee:` records the actor that has claimed the issue
- Comments and conversation history append under `## Comments`
- A resolved issue records its answer under `## Resolution`

## When a skill says "publish to the issue tracker"

Create a file under `.scratch/<feature-slug>/`, creating its `issues/`
directory when needed.

## When a skill says "fetch the relevant ticket"

Read the referenced file. The user will normally provide its path, title, or
issue number.

## Wayfinding operations

### Maps and child tickets

- A Wayfinder map is an issue file with `Type: wayfinder:map`
- Use `.scratch/<feature-slug>/issues/00-<map-slug>.md` for the map so its
  index is visually first
- A child ticket records `Parent:` with the map's relative path
- A child ticket records one of `Type: wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`
- Refer to maps and tickets by their Markdown-linked titles in human-facing
  text, not by bare issue numbers

### Blocking and frontier

- A ticket records dependencies as a comma-separated `Blocked by:` list of
  relative issue paths; use `none` when it has no blockers
- A ticket is unblocked when every listed blocker has `State: closed`
- The frontier is the ordered set of child tickets whose `State:` is `open`,
  whose blockers are all closed, and whose `Assignee:` is `unassigned`

### Claiming

Before working a ticket, replace `Assignee: unassigned` with the actor name.
The assignee is the claim; other sessions must skip claimed tickets.

### Resolution

To resolve a ticket:

1. Append the answer under `## Resolution`
2. Set `State: closed`
3. Update the parent map's `## Decisions so far` with a linked one-line gist
4. Create newly visible tickets before adding their blocking relationships
5. Remove graduated material from `## Not yet specified`

If a ticket is found to be beyond the map's destination, close it as
out-of-scope and link it under the map's `## Out of scope` instead of
`## Decisions so far`.
