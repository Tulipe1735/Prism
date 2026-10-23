# AGENTS.md — Prism

Prism is a TypeScript-based browser agent and extensible agent workbench. Its browser
automation layer uses CDP, and its agent runtime coordinates model decisions, tool
execution, observations, and task outcomes.

The architectural direction is a small, composable agent harness inspired by DeepSeek
Harness. Agent capabilities should be assembled from plugins and presets instead of
being hardcoded into the agent loop.

## Instruction Loading

`AGENTS.md` is the baseline for Standard tasks. Creator Mode retains applicable project
constraints and additionally loads
[`skills/prism/creator/SKILL.md`](skills/prism/creator/SKILL.md) for plugin authoring.
The host loads this file only while Creator Mode is enabled; ordinary skill discovery
does not expose it as a Standard capability.

The current Creator switch and backend plugin composition are kernel-wide. Bundle
preparation and activation are separate operations. Session-scoped presets below are
architectural requirements, not guarantees of the current implementation.

## Standard Operation

- Complete the requested task with available tools and relevant skills. Preserve
  existing drafts and unrelated workspace changes.
- Read the instructions for a relevant skill before using it. Ground browser actions in
  current observations and verify the resulting state.
- Use native tool calls with valid JSON arguments. Treat tool results as evidence;
  report errors and missing capabilities explicitly.
- Keep long-task context focused on the goal, confirmed facts and pending checks. A
  large context window does not justify repeatedly reading the whole repository.
- Finish with the actual changes, verification and any blocker. Use concise explanations
  of decisions and results without exposing private reasoning.
- Plugin-authoring requests require Creator Mode and its dedicated guidance. Standard
  operation must not install executable plugins through alternate tools.

## Engineering Principles

- Do not preserve backward compatibility for obsolete internal APIs. Remove outdated
  paths instead of adding compatibility layers.
- Choose the simplest implementation that fully meets current requirements.
- Grow the system incrementally. Every architectural step must leave a working
  end-to-end product.
- Keep modules cohesive and responsibilities clearly separated.
- Prefer existing dependencies and established libraries over custom infrastructure.
- Avoid speculative abstractions. Introduce extension points only when required by a
  concrete use case.
- Make architectural decisions for the long term without introducing unnecessary
  complexity today.

## Architecture Boundaries

The system is divided into five conceptual layers:

1. **Host** — Owns application-wide infrastructure, configuration, plugin discovery, and
   shared services.
2. **Preset Registry** — Resolves which capabilities an agent session should receive.
3. **Agent Session** — Owns its conversation, selected preset, runtime state, and
   lifecycle.
4. **Agent Runtime** — Runs the shared observe-decide-execute-feedback loop.
5. **Plugins** — Contribute tools, prompt sections, skills, and other explicitly defined
   capabilities.

These are architectural responsibilities, not mandatory directories or classes.

Do not reorganize the repository solely to match this vocabulary.

## Agent Runtime

- Maintain one shared agent execution mechanism across all presets.
- Keep model interaction, tool dispatch, observations, error reporting, and termination
  independent of specific modes.
- Do not create separate agent loops for Standard and Creator.
- Do not add mode-specific branches throughout the core execution loop.
- Preserve structured execution events and machine-checkable outcomes.
- Preserve the separation between browser observation, action resolution, execution, and
  validation.
- Fail explicitly when an expected capability is unavailable. Do not silently substitute
  unrelated tools.

## Plugin System

Plugins are the preferred extension mechanism for agent-visible capabilities.

A plugin may contribute tools, prompt sections, skills, or explicitly registered
lifecycle hooks.

- Define a minimal, typed plugin contract before supporting dynamic plugins.
- Prefer explicit registration and dependency declarations.
- Keep plugin implementations independent of UI components.
- Do not allow plugins to mutate another session's tool registry or prompt composition.
- Distinguish process-wide infrastructure from session-scoped capabilities.
- Validate plugin configuration and dependencies before activation.
- Support clean disposal and cleanup of plugin-owned resources.
- Treat third-party plugin code as untrusted executable code. Tool visibility and
  registration scopes are not security sandboxes.

Do not reproduce Cordis solely for architectural similarity. Use a simpler local
registry until concrete requirements justify a more advanced plugin framework.

## Agent Presets

A preset defines an agent's composition, not its execution algorithm.

Presets may declare:

- Agent identity and system prompt sections.
- Available tools.
- Available skills.
- Plugin contributions.
- Execution settings and capability restrictions.

Presets must be resolved when an agent session is created.

Each session retains its resolved preset unless an explicit session-reconfiguration
operation is supported.

Changes to the default preset affect new sessions only.

### Standard

Standard is the default mode for ordinary agent tasks.

- Provide stable, general-purpose capabilities.
- Load only tools and skills relevant to normal operation.
- Do not expose plugin-authoring or runtime-mutation capabilities by default.

### Creator

Creator is the plugin-authoring mode.

- Reuse the same agent runtime as Standard.
- Include Standard capabilities where appropriate.
- Add plugin-development instructions and authoring tools.
- Inspect the available plugin contracts and runtime capabilities before generating
  code.
- Create plugins through the supported plugin contract rather than modifying the agent
  loop.
- Validate and test generated plugins before proposing activation.
- Keep plugin creation, installation, and activation as separate operations.
- Require explicit user authorization before enabling generated executable code.

Creator is a preset, not a second agent implementation.

Do not implement Creator by inserting a large conditional prompt or a collection of
`mode === "creator"` checks into unrelated runtime modules.

## Session Isolation

- Store the selected preset as part of session identity or metadata.
- Resolve agent-visible tools and prompt sections within the session's capability scope.
- Do not mutate process-wide registries when switching modes.
- Do not let one session change another session's active capabilities.
- Keep the configured default preset separate from one-time session selections.
- A Creator entry point should create or select a Creator session without changing the
  default preset.
- Do not hot-swap active session capabilities implicitly.

## Plugin Authoring Guidance

When Creator Mode is enabled, follow the dedicated
[Creator Skill](skills/prism/creator/SKILL.md). It owns the authoring procedure, current
host contract, validation criteria and activation authorization boundary. Generated
artifacts must remain distinguishable from installed and active plugins; validation and
activation claims require execution evidence.

When changing DeepSeek model integration, read the
[V4.1 Flash integration notes](skills/prism/creator/references/deepseek-flash.md) for
verified API behavior and the gaps in the current transport.

## Workbench Integration

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- The UI selects presets and displays session state; it does not implement agent
  capabilities.
- The Host is responsible for resolving and constructing session compositions.
- Expose available presets through a typed interface rather than hardcoded UI
  assumptions.
- Keep mode-specific UI behavior at the session creation boundary.
- Preserve existing unsent drafts when navigating between creation flows where
  practical.
- Surface unavailable presets and failed plugin activation explicitly.

## Testing

Test architectural boundaries rather than only successful user flows.

Required coverage for changes to the preset or plugin system includes:

- Standard exposes its declared capabilities.
- Creator exposes its additional declared capabilities.
- Standard does not inherit Creator-only capabilities.
- Creating a Creator session does not mutate the default preset.
- Existing sessions retain their original composition.
- Plugin initialization and disposal behave correctly.
- Failed plugin registration does not leave partially active capabilities.
- Invalid plugins cannot be activated through the supported workflow.

For browser automation changes, continue testing action grounding, stale-state handling,
validation, and termination behavior.

Use the project's existing type-checking, linting, formatting, build, and test commands.
Do not invent command names.

## Documentation

- Keep this root file focused on durable engineering constraints.
- Place detailed architecture specifications in `docs/`.
- Place procedural plugin-authoring instructions in a dedicated Skill.
- Keep runtime system prompts in the preset or prompt implementation.
- Document the current behavior separately from the target architecture.
- Do not claim that planned interfaces or isolation guarantees already exist.

## Communication Style

Use an ADHD-friendly style in user-facing responses.

- Put conclusions and recommended actions first.
- Prefer short paragraphs and clear sections.
- Explain one idea at a time.
- Use concrete examples and trace real state changes where useful.
- Keep technical terminology consistent.
- Avoid filler, unnecessary repetition, and ambiguous references.
- Preserve technical depth without unnecessary complexity.
