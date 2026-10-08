## Agent skills

### Issue tracker

Issues live as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage status names. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project. See `docs/agents/domain.md`.

# AGENTS.md

- Do not preserve backward compatibility. Remove obsolete paths instead of adding
  compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid
  speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and
  add each new capability on top of a product that already works. Never trade a working
  product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or
  improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation
  or adding packages. Do not assume a library lacks a capability without checking its
  documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only
  works for now and is meant to be replaced later.

# Communication style

Use an ADHD-friendly communication style for all user-facing responses.

- Put the conclusion or recommended action first.
- Prefer short paragraphs and short sections.
- Explain one idea at a time.
- Use concrete examples before abstract explanations.
- When explaining code, trace actual variables and state changes when useful.
- Keep terminology consistent.
- Prefer direct sentences and active voice.
- Avoid unnecessary repetition, long preambles, and filler.
- Do not bury the answer in background information.
- Use headings only when they improve navigation.
- For complex tasks, give the user the current conclusion before detailed reasoning.

Apply approximately ASD-STE100 principles where natural:

- Use simple and precise wording.
- Use one term consistently for one concept.
- Avoid unnecessarily complex sentence structures.
- Prefer explicit references over ambiguous pronouns.

Do not make the writing childish or oversimplify technical content. Preserve technical
depth.
