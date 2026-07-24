# Reusable coding-agent runtimes

Research date: 2026-07-24

## Question and evaluation frame

This research looks for an actively maintained, open-source runtime that can sit
behind Prism's coding route. The browser route remains responsible
for observation and verification; the coding route owns repository inspection,
source edits, shell commands, and tests. A suitable runtime therefore needs a
programmatic boundary, a usable inspect/edit/execute/feedback loop, resumable
state, and enforceable policy or sandbox integration.

The result is a shortlist, not a selection. Each candidate still needs the same
local contract spike before an architecture decision is made.

## Shortlist at a glance

| Candidate | Embed boundary | Runtime / license | Repo, patch, command, test loop | Persistence / resume | Policy and sandbox | Maturity and primary integration risk |
| --- | --- | --- | --- | --- | --- | --- |
| **OpenCode** | `@opencode-ai/sdk` can start a server plus client or connect to an existing HTTP server; SSE events and an ACP subprocess are available | TypeScript codebase; JS/TS SDK; MIT | First-class file search/read/status, edit tools, shell commands, LSP/formatters and agent turns. Tests are ordinary shell commands, so Prism must impose the final test contract | Durable sessions are listable/readable through the SDK; CLI supports continue-by-latest or session ID | Granular `allow` / `ask` / `deny` rules for shell patterns, edits and external directories. This is an application permission layer, not an OS sandbox | Very active and widely used, with a June 2026 release. Lowest-friction TypeScript candidate. Main risk: a fast-changing API and no hard isolation boundary by itself |
| **OpenAI Codex** | `@openai/codex-sdk` spawns the Rust CLI and exchanges JSONL; app-server and the Apache-licensed `codex-acp` adapter expose a richer event/control boundary | Rust runtime, TypeScript SDK; Apache-2.0 | Purpose-built coding loop with shell execution, file-change/apply-patch events and test commands. The orchestrator still decides which tests are acceptance gates | Threads persist under `~/.codex/sessions` and the SDK supports `resumeThread()` | Native read-only/workspace-write/full-access sandbox policies plus approval policies; app-server exposes these per turn | Very active, large project, June 2026 release. Strongest ready-made safety/resume story. Main risks: OpenAI/Codex coupling, shipping a native binary, and the simpler SDK exposing less control than app-server/ACP |
| **OpenHands Software Agent SDK** | Direct Python objects (`Agent`, `Conversation`, tools), plus a REST/WebSocket Agent Server | Python and REST; MIT | Built-in terminal and file-editor tools; custom tools/MCP; tests run through the terminal and can be wrapped in a custom workflow | Conversation persistence saves and restores event history, agent/tool configuration, execution state, tool outputs, statistics and workspace context | Confirmation policies, pluggable deterministic/LLM security analyzers, and local or ephemeral Docker/Kubernetes workspaces | Mature OpenHands lineage and active 2026 SDK releases, but the redesigned SDK itself is younger. Main risk: the largest operational surface and a Python service boundary if Prism stays TypeScript-first |
| **mini-SWE-agent** | Small direct Python API (`DefaultAgent`, model, environment) designed for subclassing | Python; MIT | Minimal model/command/observation loop; local, Docker, SWE-ReX, Bubblewrap and other environments; trajectory output can contain the submitted patch. No dedicated production test gate | Serializes full trajectories, messages and configuration, but the documented v2 API does not provide a supported restore-and-continue contract | Isolation is selectable; local is the default and has none. Validation/deny behavior is an extension example, not a comprehensive built-in policy engine | Active May 2026 releases and deliberately small code. Best as a transparent prototype/evaluation baseline, not the default production runtime without adding persistence, approvals and orchestration |

## Candidate notes

### OpenCode: TypeScript-first headless runtime

OpenCode is the cleanest native fit if Prism remains TypeScript-first. The
official SDK's `createOpencode()` starts the server and type-safe client together;
`createOpencodeClient()` connects to an already-running server. Sessions,
messages, prompts, shell execution, file search/read/status, abort/revert, and an
SSE event stream are public API surfaces. It can also run as `opencode acp`, a
stdio ACP server.

Its permission rules can independently gate command patterns, edits, reads, and
access outside the working directory. However, those rules should be treated as
policy, not containment: run the process inside Prism' own workspace
sandbox/container and make the orchestrator the final authority for writable
roots, network access and timeouts.

Sources:

- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode server API](https://opencode.ai/docs/server/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode CLI session and automation controls](https://opencode.ai/docs/cli/)
- [OpenCode ACP support](https://opencode.ai/docs/acp/)
- [OpenCode repository and MIT license](https://github.com/anomalyco/opencode)

### OpenAI Codex: TypeScript wrapper over a hardened native runtime

The supported TypeScript SDK is intentionally simple: start or resume a thread,
run a turn, stream structured events, attach images and constrain final output by
JSON Schema. It wraps the Codex CLI rather than embedding a JavaScript agent
loop. For approvals, sandbox selection, command lifecycle and richer event
mapping, Prism would use Codex app-server directly or the official ACP
adapter instead of expanding a private SDK wrapper.

This is the most complete off-the-shelf match for persisted coding threads plus
native sandbox policies. The trade-off is product/provider coupling: although
configuration and custom gateway paths exist, Codex is not a model-neutral agent
framework. Native-binary packaging and Windows/WSL behavior must be part of the
spike.

Sources:

- [Codex TypeScript SDK](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
- [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex sandbox modes and runtime organization](https://github.com/openai/codex/blob/main/codex-rs/README.md)
- [Codex repository, releases and Apache-2.0 license](https://github.com/openai/codex)
- [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp)

### OpenHands: composable Python SDK and remote agent server

OpenHands exposes the internal pieces that Prism would otherwise have to
build: agent, conversation, terminal and file-editor tools, workspaces,
persistence, callbacks, metrics, MCP integration and a remote Agent Server. A
Python worker can therefore live behind a narrow HTTP/WebSocket adapter while
the TypeScript control plane remains unchanged.

Its security surface is unusually explicit. Conversations can always confirm,
never confirm, or confirm risky actions; custom deterministic analyzers can run
before tool execution. These controls are complementary to, not a replacement
for, Docker/Kubernetes isolation. One documented escape hatch,
`conversation.execute_tool()`, bypasses the analyzer/confirmation loop, so the
Prism adapter must not expose it as an ungoverned path.

Sources:

- [OpenHands Software Agent SDK repository, quick start, REST API and MIT license](https://github.com/OpenHands/software-agent-sdk/)
- [Conversation persistence](https://docs.openhands.dev/sdk/guides/convo-persistence)
- [Security and action confirmation](https://docs.openhands.dev/sdk/guides/security)

### mini-SWE-agent: minimal reference implementation

mini-SWE-agent is useful because its Python binding and main agent loop are small
enough to understand and replace. Models, agents and execution environments can
be mixed; the environment can be local, Docker, SWE-ReX, experimental
Bubblewrap, or another backend. Subclass examples show how to intercept commands
and add deterministic deny rules.

It should not be mistaken for a complete production runtime. The local
environment is explicitly unsandboxed, its policy hooks are patterns implemented
by the adopter, and its documented output is a trajectory rather than a durable
session that can be restored and continued. It is a strong oracle for a minimal
coding loop and for evaluation fixtures, and a higher-effort production choice.

Sources:

- [mini-SWE-agent repository, activity and MIT license](https://github.com/SWE-agent/mini-swe-agent)
- [Basic Python binding](https://mini-swe-agent.com/latest/usage/python_bindings/)
- [Composable agents and execution hooks](https://mini-swe-agent.com/latest/advanced/cookbook/)
- [Execution environments](https://mini-swe-agent.com/latest/advanced/environments/)
- [Trajectory output format](https://mini-swe-agent.com/latest/usage/output_files/)
- [2026 releases](https://github.com/SWE-agent/mini-swe-agent/releases)

## Cross-language boundary: ACP v1

ACP is not a coding-agent runtime. It is an Apache-2.0 protocol and set of
official TypeScript, Python, Rust, Kotlin and Java libraries for connecting a
client to a coding agent. Its v1 protocol already represents working directory,
session creation, optional load/resume, prompt turns, streamed tool calls,
diffs, terminals, cancellation and permission requests. OpenCode implements ACP
natively, and the ACP organization publishes a Codex adapter.

This makes ACP v1 a credible boundary for Prism' `CodingAgentAdapter`, but
not a sufficient internal domain model:

- Treat every optional capability, especially load/resume, as negotiated rather
  than assumed.
- Keep Prism' own canonical trace and task state; do not delegate product
  persistence to the agent session alone.
- Preserve vendor event metadata beside normalized events so useful sandbox,
  token and tool details are not discarded by a lowest-common-denominator
  adapter.
- Stay on ACP v1 for a first implementation; ACP v2 is explicitly still a draft.

Sources:

- [ACP protocol and official libraries](https://github.com/agentclientprotocol/agent-client-protocol)
- [Official TypeScript SDK package](https://www.npmjs.com/package/@agentclientprotocol/sdk)
- [Session create, load and resume semantics](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Tool calls, diffs, terminals and permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls)

## Screened out of the active shortlist

- **Aider** remains a capable Python CLI with repository maps, Git-aware edits,
  lint/test repair and one-shot scripting. Its own documentation says the Python
  scripting API is unsupported and may break without compatibility guarantees;
  the official repository's latest release is August 2025. It also lacks the
  session-resume and policy/sandbox boundary required here. It is useful as a
  behavioral reference, not the first embedding target. Sources: [scripting
  caveat](https://aider.chat/docs/scripting.html), [lint/test
  loop](https://aider.chat/docs/usage/lint-test.html), [repository and
  releases](https://github.com/Aider-AI/aider).
- **SWE-agent** is no longer the preferred integration target: its maintainers
  explicitly recommend mini-SWE-agent for new work. Source: [SWE-agent
  repository](https://github.com/SWE-agent/SWE-agent).
- General agent frameworks such as LangGraph or PydanticAI can host a custom
  implementation, but they do not supply the repository/edit/shell/test coding
  loop being evaluated. Choosing one would mean building the missing runtime,
  not reusing it.

## Shortlist and decision-enabling spike

Carry three production candidates and one reference implementation forward:

1. **OpenCode**, through its JS/TS SDK or ACP, for the lowest-friction
   TypeScript path.
2. **Codex**, through the TypeScript SDK initially and app-server/ACP where
   richer control is required, for the strongest packaged sandbox/resume path.
3. **OpenHands**, behind a Python service adapter, for maximum model/tool/runtime
   composability.
4. **mini-SWE-agent**, as the minimal Python baseline used to validate that the
   Prism adapter is not accidentally coupled to one large runtime.

Before selecting among the first three, run the same fixture task through each
adapter and require:

- repository search followed by a multi-file patch;
- an intentionally failing test, a repair, and a passing final test;
- normalized streamed evidence for commands, diffs, test output and final state;
- process termination followed by successful session/task continuation;
- denial of a write outside the workspace and of a forbidden destructive
  command;
- cancellation, timeout and cost/step-limit behavior;
- execution on the project's actual Windows/WSL deployment shape, including a
  workspace path containing spaces.

The spike should compare adapter complexity, missing normalized events,
containment failures and restart behavior. Those measurements, rather than
feature lists or benchmark scores, should select the production runtime.
