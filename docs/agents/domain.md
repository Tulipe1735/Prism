# Domain Docs

This is a single-context project.

## Before exploring, read these

- `GLOSSARY.md` at the project root
- Relevant current interfaces under `docs/reference/`

If either location does not exist, proceed silently. Domain documentation is created
lazily when terms or decisions are actually resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or test, use
the term defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly
avoids.

If a needed concept is absent, reconsider whether it belongs to the domain or record the
gap for a later domain-modeling session.

## Keep the current contract aligned

When changing behavior, update its guide, reference and affected callers together. Do
not recreate historical ADRs or requirements snapshots; current behavior belongs in the
relevant guide or reference.
