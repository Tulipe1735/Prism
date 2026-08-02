# Prism Contract and Durable-Run Resources

## Knowledge

- [Prism repair-request schemas](packages/contracts/src/index.ts) The single executable
  definition of the v1 request, durable Run contracts, and structured errors. Use for:
  checking which persisted and API values are trusted.
- [Field Desk repair composer](apps/web/components/field-desk/repair-composer.tsx) The
  browser entrypoint using React Hook Form, the Zod resolver, and a TanStack Query
  mutation. Use for: tracing one valid submission to its Run dossier.
- [Repair-request Route Handler](apps/web/app/api/repair-requests/route.ts) The
  independent server boundary and durable-Run creation handoff. Use for: media type,
  body size, JSON, schema, workspace policy, and the `201` creation response.
- [Repair-request contract tests](packages/contracts/src/repair-request.test.ts)
  Deterministic examples of supported and rejected request values. Use for: changing the
  request contract with a red-green loop.
- [Repair-request route tests](apps/web/app/api/repair-requests/route.test.ts) Boundary
  tests that prove an accepted request now creates a persisted Run. Use for: following
  the HTTP seam into the Run repository.
- [Durable Run contracts](packages/contracts/src/run-contract.test.ts) Executable
  examples of the manifest, events, snapshot, artifact reference, list, and dossier
  shapes. Use for: learning the vocabulary without guessing from interfaces.
- [File trajectory store](packages/trajectory-store/src/index.ts) The canonical
  filesystem implementation of Run creation, journal projection, reload, artifact
  verification, and snapshot-cache repair. Use for: lesson 2's refresh path.
- [Trajectory-store tests](packages/trajectory-store/src/trajectory-store.test.ts) The
  strongest executable evidence for creating a Run and reopening the same state through
  a new `FileTrajectoryStore`. Use for: distinguishing disk reconstruction from browser
  or process memory.
- [Run repository tests](apps/web/lib/server/run-repository.test.ts) The web-facing
  proof that a Run can be created, listed, reopened, and surfaced as a terminal
  integrity error when stored bytes are corrupted.
- [Run dossier Server Component](apps/web/app/runs/[runId]/page.tsx) Reloads a dossier
  through the server repository before handing verified initial data to the client.
- [Run dossier client view](apps/web/components/field-desk/run-dossier.tsx) Uses
  TanStack Query `initialData` and exposes journal position, integrity, prompt, and
  hashed artifacts without making the query cache canonical.
- [Zod basic usage](https://zod.dev/basics) Primary documentation for `parse`,
  `safeParse`, inferred types, and structured errors. Use for: understanding the shared
  schema mechanics.
- [Node.js file-system promises](https://nodejs.org/api/fs.html#promises-api) Primary
  documentation for the `readFile`, `writeFile`, `appendFile`, and `rename` primitives
  used by `FileTrajectoryStore`.
- [Node.js `createHash`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)
  Primary documentation for the hashing API used to address and verify artifact bytes.
- [React Hook Form resolvers](https://github.com/react-hook-form/resolvers#zod)
  Maintainer documentation for connecting `useForm` to a Zod schema.
- [TanStack Query initial data](https://tanstack.com/query/latest/docs/framework/react/guides/initial-query-data)
  Primary documentation for seeding a client query from server-loaded dossier data.
- [TanStack Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
  Primary documentation for marking Run queries stale after a successful creation.
- [Zustand introduction](https://zustand.docs.pmnd.rs/learn/getting-started/introduction)
  Primary documentation for the small client store that Prism limits to ephemeral
  filters rather than canonical Run state.
- [React Toastify introduction](https://fkhadra.github.io/react-toastify/introduction/)
  Primary documentation for transient success and failure notifications.
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  Primary documentation for the server/client module boundary and serializable props.
  Use for: why the Run page loads durable state on the server before hydrating the
  interactive dossier.
- [Next.js Route Handlers](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware)
  Primary documentation for `route.ts` and the Web `Request`/`Response` APIs. Use for:
  understanding the server-owned create, list, and dossier boundaries.
- [Confined WorkspaceExecutor](packages/workspace-executor/src/index.ts) The real path,
  ignore, patch, command, redaction, deadline, cancellation, and process-tree boundary.
  Use for: tracing why an operation was accepted or denied.
- [WorkspaceExecutor behavior tests](packages/workspace-executor/src/workspace-executor.test.ts)
  Cross-platform executable stories for inspection, exact command registration,
  traversal, symlink escape, bounded output, patch preconditions, timeout, cancellation,
  and cleanup.
- [Workspace evidence Route Handler](apps/web/app/api/runs/[runId]/workspace/route.ts)
  The independent HTTP schema boundary that commits an executor outcome to a Run.
- [Execa](https://github.com/sindresorhus/execa) Maintainer documentation for shell-free
  argument vectors, output handling, errors, cancellation, and Windows behavior. Use
  for: the command lifecycle inside WorkspaceExecutor.
- [fast-glob](https://github.com/mrmlnc/fast-glob) Maintainer documentation for bounded
  file discovery, `cwd`, ignore patterns, and `followSymbolicLinks: false`.
- [node-ignore](https://github.com/kaelzhang/node-ignore) Maintainer implementation of
  `.gitignore` matching semantics. Use for: repository-relative ignore layers.
- [Git `gitignore`](https://git-scm.com/docs/gitignore) Primary specification for root
  and nested ignore-file precedence.
- [Node.js child processes](https://nodejs.org/api/child_process.html) Primary
  documentation for detached POSIX process groups and the warning that killing a parent
  does not necessarily kill its descendants.
- [Windows `taskkill`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)
  Primary documentation for `/pid`, `/t`, and `/f` process-tree termination.

## Wisdom (Communities)

- No community is selected yet. Add one only when a real durable-state design tradeoff
  needs practitioner feedback.

## Gaps

- The current tests prove reconstruction through a fresh store instance and server
  repository. A browser-level create-refresh-reopen journey should be linked here when
  it exists.
- The initial journal contains only `run.created`, `run.queued`, and terminal integrity
  errors. Pi, UI-TARS, DAG, browser evidence, and recovery events remain later work.
- The file store does not claim power-loss durability beyond the guarantees exercised by
  its current filesystem code and tests.
