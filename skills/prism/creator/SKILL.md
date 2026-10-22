---
name: creator
description:
  Author and validate Prism Bundle plugins when Creator Mode is enabled and the user
  requests a reusable capability or a plugin change.
---

# Prism Creator Mode

Creator Mode is enabled. Follow applicable AGENTS.md instructions. Use this workflow for
reusable capabilities and plugin changes; reuse available tools when sufficient.

## Inspect, prepare, verify, enable

1. Call `creator_inspect` for live tools, installed plugins, SDK and data directory. For
   an existing plugin, call `plugin_manager` action `inspect` with its name; this
   returns the complete Bundle, preferring its staged version. Identify observable
   acceptance checks before editing.
2. Prepare a multi-file Bundle with `manifest` and `files`. Use the contract below.
   Check source, invalid inputs, cancellation and resource cleanup. Build with
   `plugin_manager install`; installation validates and builds but does not evaluate the
   backend or run apply. Report failed or unavailable checks explicitly.
3. Confirm that the user's existing request authorizes running this particular code.
   Reuse authorization already given. Creator Mode alone is not that authorization. If
   needed, present the complete prepared Bundle, effects and checks before asking to
   enable. Dependency approval belongs to the host-owned policy, not plugin code.
4. With authorization call `plugin_manager` action `enable` with `name`. Activation
   evaluates the backend and calls apply. A failed activation cleans new capabilities
   and attempts to restore the previous instance; inspect actual state before claiming
   recovery. Installation and enablement are distinct operations.
5. Discover and invoke new tools from the next model request. Verify the acceptance
   checks and invalid inputs. Report the plugin's actual state and any limitation.
   Successful compilation or activation alone does not establish correct behavior.

## Bundle format

`install` takes `{ action: "install", bundle: { manifest, files } }`. The manifest is:

- `schemaVersion: 1`, `name`, `version`, `description`, `backend` (relative source
  path).
- Optional `dependencies`: npm package names mapped to exact versions.
- Optional `ui`: up to 16 `{ id, slot, title, entry }` declarations.
- Optional `assets`: `{ from, to }` paths copied to each UI's output. Sources may be
  Bundle text files or assets below a declared `node_modules/<package>` dependency.

Names begin with a lowercase letter and use lowercase letters, digits or hyphens, up to
64 characters. `dependency-policy` is reserved. Versions are exact semver versions.
`files` maps relative POSIX paths to complete source strings: at most 128 files and 1 MB
total. Reject traversal, absolute paths, symlinks, package.json, prism.plugin.json and
node_modules in files. The manifest is supplied separately.

JavaScript, TypeScript, TSX, relative modules, CSS and declared npm dependencies are
compiled with esbuild. Node built-ins work in the backend. UI cannot import Node
built-ins, undeclared packages or host source. Do not use DSH service names or assume
DSH compatibility.

Dependency installation uses the host's fixed pnpm, a private install and store, public
npm registry, a lockfile, disabled lifecycle scripts and disabled pnpmfile hooks. Direct
packages and versions must already appear in `<directory>/dependency-policy.json`
(directory is printed by inspection). There is no plugin-manager action to approve
packages. On rejection report the exact required package/version; do not edit the
policy, run another installer or modify host dependencies to bypass it. Pins and
approval cover installation, not sandboxing executable code or independently approving
every transitive package.

A first install is disabled. An update is staged while the current instance keeps
running; enable applies the staged version. The obsolete `source` installation shape is
removed; existing on-disk single-file records migrate automatically on startup.

## Backend and lifecycle

Export `inject` (required service names) and `apply(ctx, api)` from the backend. Types
are available from `@prism/plugin-sdk`. The supported SDK context exposes `effect`,
`tools.register`, `config.dataDir`, and `sessions.read`. Inspect before relying on other
live host services.

- Register tools with `ctx.effect(() => ctx.tools.register(tool))`. Mutable state
  belongs inside apply. Register resource cleanup with ctx.effect; generator effects
  clean up in reverse order. Initialization should be reversible. The runtime also
  tracks direct tool registrations so a failed initialization leaves none behind.
- A tool has `name`, `description`, JSON Schema `parameters`, optional
  `effects(args,context)` and `async execute(args,context)`. Return
  `{ content: string, isError?: boolean }`. Validate inputs in execute.
- Tool names use letters, digits, underscores or hyphens, at most 64 characters. Names
  must be unique. `creator_inspect` and `plugin_manager` are reserved.
- Declare file writes as `{ kind: "file-write", path }`, commands as
  `{ kind: "command", command }`, browser actions as
  `{ kind: "browser-action", action, target }`. Tool context includes workspace,
  sessionId, scope, permissions, target, signal and requestApproval. Honor cancellation.
- `api.dataDir` is persistent plugin-owned data. `api.rpc.register(name,handler)`
  registers a method within this plugin's namespace; wrap the returned disposer in
  ctx.effect. Handlers receive `(input,{sessionId,signal})`; session identity comes from
  the host. Validate inputs and honor signal. RPC is a user UI channel; expose Agent
  actions through permission-checked tools.
- `api.emit(name,data,sessionId?)` publishes a namespaced plugin event. Keep payloads
  JSON-compatible. `api.onSessionRemoved(listener)` supports plugin-owned cleanup.
- Throw `PluginError(code,message,status)` from `@prism/plugin-sdk` for structured
  user-facing RPC errors, without changing host error types or routes.

## UI and development

Choose from ten supported slots:

- `workbench.header`: top bar after the workspace name; compact controls.
- `workbench.sidebar`: expanded navigation, between workspace and session list.
- `workbench.panel`: on-demand, expandable main panel with host launch buttons.
- `workbench.status`: bottom status bar; compact controls.
- `session.header`: beside the session title, before context compression; compact
  controls.
- `session.toolbar`: below the session header; compact controls.
- `session.footer`: after conversation content, before approvals and input.
- `composer.toolbar`: between the text input and send controls; compact controls.
- `inspector.panel`: artifacts tab after the file list.
- `settings.panel`: settings tab extension area.

Compact frames are 40 px high and arrange horizontally; content frames are 192 px high
in scrollable regions. The main panel fills its opened area. Collapsing navigation or
switching inspector tabs disposes the corresponding frames. All positions use the same
session context and hot reload. Slots provide presentation; the bridge does not expose
the host's unsent draft. The host renders manifest contributions generically; keep
feature components, styles, framework dependencies, fonts and event handling inside the
Bundle. Standard plugins must not require host frontend edits.

UI is an independently built iframe entry. Use `PluginClient` from
`@prism/plugin-sdk/client`: `onContext(listener)` supplies sessionId and connected;
`request(method,input)` calls this plugin's RPC; `subscribe(listener)` receives its
events; `close()` releases listeners and pending requests. Set up the bridge before
sending requests. Context may initially have no session. Release resources on pagehide.
UI frames separate presentation and lifecycle; same-origin scripts support workers, so
frames are not a security sandbox for untrusted code.

For local development, save `prism.plugin.json` and source files in a directory.
`develop` with absolute `directory` prepares a snapshot; separately enable it. Source
changes then debounce and rebuild the full graph, including nested modules and UI. Build
failure retains the old version; backend initialization failure restores it; errors
remain visible and corrected source retries automatically. Dependency changes still
require policy approval. Disabling stops watchers and cancels active calls.

`plugin_manager` also supports list, inspect, disable, reload and remove. These require
name except list. Reload applies to an enabled current instance; enable selects a staged
update. Removing an installation preserves its persistent data. Turning off Creator Mode
withdraws authoring tools while active bundles remain running. The current Creator
switch and backend composition are kernel-wide; session presets and capability isolation
remain future work.

## DeepSeek V4.1 Flash

Use native tool calls with JSON arguments, not tool-call text in the answer. Keep tool
descriptions specific and outputs concise, with enough evidence to check the result.
Inspect only relevant source and preserve confirmed decisions and pending checks across
long tasks. Report actions and results without requesting or reproducing private
reasoning.

Model capabilities depend on the transport. The current host sends text and tool calls;
it does not deliver image content blocks or retain `reasoning_content`. A local image
path is not a delivered image, and prompt wording cannot enable thinking or JSON strict
mode. Changes to model transport belong in the host, outside this plugin contract.

## Minimal tool example

```js
export const inject = ["tools"];

export function apply(ctx) {
  ctx.effect(() =>
    ctx.tools.register({
      name: "word_count",
      description: "Count whitespace-separated words in text; empty text returns 0.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args) {
        if (typeof args?.text !== "string")
          return { content: "text must be a string", isError: true };
        const text = args.text.trim();
        return { content: String(text === "" ? 0 : text.split(/\s+/u).length) };
      },
    }),
  );
}
```
