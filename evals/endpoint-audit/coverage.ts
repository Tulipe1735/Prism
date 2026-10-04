import type { AddressInfo } from "node:net";
import type { Observation } from "../../src/browser/session.ts";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { startExternalSources } from "../external/server.ts";

/**
 * P0-C browser verification of the external audit contract. Read-only over the published
 * sources: it never rewrites a source page and never calls a model. It answers the two
 * questions that the frozen records cannot answer on their own:
 *
 *   1. which controls the oracle selectors actually match, and how many elements they match;
 *   2. whether the correct control is offered, and whether a legal ancestor action exists
 *      that the frozen audit must score as neutral.
 */
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
};

export const ARCHIVE_ROOT = resolve("evals/results/external-validation-v1-sources");

/**
 * Serves the published sources plus the archived copies of the two live pages, so a whole
 * coverage pass runs on loopback without depending on the public network.
 */
export async function startAuditSources(
  port = 9844,
): Promise<{ url: string; close: () => Promise<void>; served: Set<string> }> {
  const roots = [resolve(".scratch/external-validation-v1/sources"), ARCHIVE_ROOT];
  const served = new Set<string>();
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://local").pathname,
        );
        for (const root of roots) {
          const path = resolve(root, `.${pathname}`);
          if (!path.startsWith(`${root}${sep}`)) continue;
          try {
            const data = await readFile(path);
            served.add(pathname);
            response.writeHead(200, {
              "content-type": MIME[extname(path)] ?? "application/octet-stream",
            });
            response.end(data);
            return;
          } catch {
            /* Try the next root. */
          }
        }
        response.writeHead(404).end();
      } catch {
        if (!response.headersSent) response.writeHead(404);
        response.end();
      }
    })();
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    served,
    close: () =>
      new Promise((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
}

/** The frozen external harness replays its own sources; keep both entry points available. */
export { startExternalSources };

export interface SelectorCoverage {
  selector: string;
  matches: number;
  offered: number;
}

export interface TaskCoverage {
  taskId: string;
  url: string;
  correct: SelectorCoverage;
  candidate: SelectorCoverage;
  /** Offered actions that are an ancestor of the correct control. */
  legalAncestors: { actionId: string; label: string; node: number }[];
  /** The correct control is offered, so a scored attempt is possible at all. */
  correctOffered: boolean;
  /** The candidate selector also matches the correct control. */
  correctIsCandidate: boolean;
  /** Offered elements that the candidate selector matches. */
  candidateOffered: number;
  /**
   * True when an offered action contains another offered action that the frozen candidate
   * selector matches. The frozen audit then scores a click on the container as neutral
   * instead of wrong, so the recorded grounding endpoint depends on which element was hit.
   */
  auditGap: boolean;
}

export async function inspectTask(
  evaluator: { call: (method: string, params?: object) => Promise<any> },
  task: { id: string; url: string },
  metadata: {
    correct_selector: string;
    candidate_selector: string;
    planned_minimum_steps: number;
  },
  snapshot: Observation,
): Promise<TaskCoverage> {
  const nodes = [
    ...new Set(
      snapshot.actions.flatMap((action) =>
        action.node === undefined ? [] : [action.node],
      ),
    ),
  ];
  const response = await evaluator.call("Runtime.evaluate", {
    expression: `(() => {
        const correct = ${JSON.stringify(metadata.correct_selector)};
        const candidate = ${JSON.stringify(metadata.candidate_selector)};
        const correctEls = [...document.querySelectorAll(correct)];
        const candidateEls = [...document.querySelectorAll(candidate)];
        const nodes = ${JSON.stringify(nodes)};
        const offered = nodes.map((id) => [id, window.__jevFast.nodes.get(id)]);
        const offeredCorrect = offered.filter(([, el]) => el && correctEls.includes(el));
        const offeredMatchingCandidate = offered.filter(([, el]) => el && candidateEls.includes(el));
        const ancestors = offered
          .filter(([, el]) => el && correctEls.some(correctEl => el !== correctEl && el.contains(correctEl)))
          .map(([id, el]) => ({ node: id, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40) }));
        // A nested duplicate: one offered action contains another offered action, and the
        // frozen candidate selector matches the container.
        const nested = offered.filter(([id, el]) => el && candidateEls.includes(el) &&
          offered.some(([otherId, other]) => otherId !== id && other && el.contains(other) && candidateEls.includes(other)));
        return {
          correct_matches: correctEls.length,
          candidate_matches: candidateEls.length,
          offered_correct: offeredCorrect.length,
          offered_candidate_among_correct: offeredCorrect.filter(([, el]) => candidateEls.includes(el)).length,
          offered_correct_elements: offeredCorrect.length,
          offered_matching_candidate: offeredMatchingCandidate.length,
          ancestors,
          nested: nested.map(([id, el]) => ({ node: id, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40) })),
        };
      })()`,
    returnByValue: true,
  });
  if (response.exceptionDetails || !response.result?.value)
    throw new Error(`Selector coverage failed for ${task.id}.`);
  const value = response.result.value;
  return {
    taskId: task.id,
    url: task.url,
    correct: {
      selector: metadata.correct_selector,
      matches: value.correct_matches,
      offered: value.offered_correct,
    },
    candidate: {
      selector: metadata.candidate_selector,
      matches: value.candidate_matches,
      offered: value.offered_matching_candidate,
    },
    legalAncestors: value.ancestors,
    correctOffered: value.offered_correct > 0,
    correctIsCandidate: value.offered_candidate_among_correct > 0,
    candidateOffered: value.offered_matching_candidate,
    auditGap: value.ancestors.length > 0 || (value.nested ?? []).length > 0,
  };
}

/**
 * Coverage is state-dependent. Multi-step tasks can intentionally match several correct
 * controls; report that contract without asserting an oracle defect. Ancestor containment
 * alone does not prove activation; the known-control browser test checks that separately.
 */
export function classifyCoverage(rows: TaskCoverage[]): string {
  return [
    "| task | correct matches | correct offered | candidate matches | legal ancestor actions | coverage gap |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `${[
          `| ${row.taskId}`,
          String(row.correct.matches),
          String(row.correct.offered),
          row.correctIsCandidate
            ? `${row.candidate.matches} (includes the target)`
            : String(row.candidate.matches),
          String(row.legalAncestors.length),
          [
            row.auditGap ? "unscored ancestor/nested action" : null,
            row.correct.matches === 0 ? "no matching control in this state" : null,
            row.correct.matches > row.correct.offered
              ? `${row.correct.matches - row.correct.offered} matched controls not offered in this state`
              : null,
            row.correct.matches > 1
              ? "multi-target contract; inspect task stage"
              : null,
          ]
            .filter(Boolean)
            .join("; ") || "none",
        ].join(" | ")} |`,
    ),
  ].join("\n");
}
