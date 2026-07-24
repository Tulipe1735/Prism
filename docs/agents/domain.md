# Domain Docs

This is a single-context project.

## Before exploring, read these

- `CONTEXT.md` at the project root
- Relevant architectural decisions under `docs/adr/`

If either location does not exist, proceed silently. Domain documentation is
created lazily when terms or decisions are actually resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or
test, use the term defined in `CONTEXT.md`. Do not drift to synonyms the
glossary explicitly avoids.

If a needed concept is absent, reconsider whether it belongs to the domain or
record the gap for a later domain-modeling session.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly
instead of silently overriding the decision.
