# 01 — Establish the real Field Desk and shared Prism contracts

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: none

**What to build:** Replace the throwaway Field Desk data with a production-shaped Next.js application shell where a user can enter a frontend repair request and receive immediate, shared-contract validation. Preserve the selected workspace-first information hierarchy while establishing the pnpm workspace and reusable UI foundation needed by later runtime slices.

- [x] The Field Desk renders as a real Next.js product entry with the selected repair composer, recent-run area, and second-level Run dossier hierarchy, without depending on the prototype's mock run records.
- [x] Repair requests and the first versioned Prism contracts are defined once with Zod and are validated at both browser and server boundaries, including useful errors for malformed or unsupported input.
- [x] The workspace uses Turborepo and shared TypeScript, lint, formatting, and test configuration, with a production build, typecheck, and Vitest contract suite passing.
- [x] The GUI foundation preferentially reuses the Pulse-proven Tailwind, Radix UI, class-variance-authority, clsx, tailwind-merge, and Lucide stack while preserving the approved Field Desk visual hierarchy.
- [x] Next.js and React versions are pinned as one verified compatible set; adopting the Pulse versions requires the Field Desk production build and prototype-regression checks to pass.
- [x] Unrelated Pulse dependencies such as authentication, payments, databases, and Redis are not introduced without a Prism requirement.

## Resolution

Established the pnpm/Turborepo workspace, production Field Desk hierarchy, shared
versioned Zod contracts, and independent browser/server validation boundaries.
Recent Runs and Run dossiers now report honest empty/not-found states until the
runtime slice lands; the preserved prototype remains available only under its
dedicated route.

Verified with formatting, lint, typecheck, 15 Vitest tests (including a
repeatable prototype-isolation regression), a production build, and Playwright
checks covering desktop, mobile, the prototype route, empty runs, unknown
dossiers, and the browser/server repair-request flow.
