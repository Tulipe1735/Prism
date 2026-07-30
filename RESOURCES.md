# Prism Contract-Boundary Resources

## Knowledge

- [Prism repair-request schemas](packages/contracts/src/index.ts) The single executable
  definition of the v1 request, validation receipt, and structured error. Use for: every
  browser/server contract question in lesson 1.
- [Field Desk repair composer](apps/web/components/field-desk/repair-composer.tsx) The
  browser boundary and response fail-closed behavior. Use for: tracing user input,
  `safeParse`, fetch, and accessible feedback.
- [Repair-request Route Handler](apps/web/app/api/repair-requests/route.ts) The
  independent server boundary. Use for: media type, body size, JSON, schema, and
  workspace-policy checks.
- [Contract and route tests](packages/contracts/src/repair-request.test.ts)
  Deterministic examples of supported and rejected values. Use for: changing the
  contract with a red-green loop.
- [Zod basic usage](https://zod.dev/basics) Primary documentation for `parse`,
  `safeParse`, inferred types, and structured errors. Use for: understanding the shared
  schema mechanics.
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  Primary documentation for the server/client module boundary and serializable props.
  Use for: why only the interactive composer carries `"use client"`.
- [Next.js Route Handlers](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware)
  Primary documentation for `route.ts` and the Web `Request`/`Response` APIs. Use for:
  understanding the second, server-owned validation boundary.

## Gaps

- No durable Run example exists yet; add its primary code and replay tests after the
  create-and-reopen Runs ticket is implemented.
- No community resource is selected yet. Add one only when a real design tradeoff needs
  practitioner feedback.
