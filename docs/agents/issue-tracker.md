# Issue tracker: Local Markdown

Issues and Wayfinder maps for this repository live as Markdown files under
`.scratch/`.

## Conventions

- One effort per directory: `.scratch/<effort-slug>/`
- The canonical Wayfinder map is `.scratch/<effort-slug>/PRD.md`
- Decision tickets are `.scratch/<effort-slug>/issues/<NN>-<slug>.md`
- Research assets are `.scratch/<effort-slug>/research/<slug>.md`
- `State:` records whether a ticket is `open` or `closed`
- `Status:` uses the vocabulary in
  [triage-labels.md](triage-labels.md)
- `Assignee: unassigned` means the ticket is unclaimed
- Resolution history is appended under `## Comments`

## Wayfinding operations

### Create a map

Create `PRD.md` with the `wayfinder:map` label and the sections Destination,
Notes, Decisions so far, Not yet specified, and Out of scope.

### Create a child ticket

Create a numbered file in `issues/` with:

- a `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or
  `wayfinder:task` label;
- a relative link to the parent map;
- `Assignee: unassigned`;
- `Blocked by:` and `Blocks:` links;
- a single decision under `## Question`.

### Claim a ticket

Replace `Assignee: unassigned` before doing any work. The assignee line is the
claim and prevents another session from taking the same ticket.

### Express blocking

This tracker has no native dependency graph, so each ticket records dependency
links under `Blocked by:`. A ticket is unblocked only when every linked blocker
has `State: closed`.

The frontier is the ordered set of child tickets that are:

1. `State: open`;
2. unblocked; and
3. `Assignee: unassigned`.

### Resolve a ticket

Append a dated resolution comment, link any research or prototype asset, set
`State: closed`, and add a one-line context pointer to the map's
`Decisions so far` section. The detailed answer lives in the ticket or linked
asset; the map contains only the gist.
