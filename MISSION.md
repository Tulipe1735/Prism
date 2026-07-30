# Mission: Continue building Prism from its real contract boundaries

## Why

Be able to extend the Visual SWE Harness without confusing UI state, transport
validation, and durable Run state. The practical outcome is to implement later Prism
slices by following real code and tests rather than relying on the roadmap alone.

## Success looks like

- Trace one repair request from the Server Component through browser validation and the
  Route Handler.
- Change a shared contract once and predict which browser, server, and test boundaries
  must react.
- Explain why a validated request is not yet a durable Prism Run.

## Constraints

- Start from actual entrypoints, functions, schemas, tests, and browser behavior.
- Keep lessons short and directly tied to the current implementation frontier.
- This mission is inferred from the current request and should be revised if the user's
  intended outcome is different.

## Out of scope

- Pi and UI-TARS runtime internals before those packages exist.
- Replay, evaluation, RL, and multi-agent material before durable Run state is
  implemented.
