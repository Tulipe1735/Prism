import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";
import { classifyCoverage, inspectTask, startAuditSources } from "./coverage.ts";

/**
 * P0-C browser coverage check for the external audit contract.
 *
 * READ-ONLY and model-free. It loads each published source, resolves the frozen oracle
 * selectors, and reports the coverage of the correct control and of the legal ancestor
 * actions. No task is re-run, no model is called, and no source page is modified.
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     evals/endpoint-audit/coverage-cli.ts [--out work/endpoint-audit] [--browser-url URL]
 */
interface TaskMetadata {
  correct_selector: string;
  candidate_selector: string;
  planned_minimum_steps: number;
}

export async function loadCoverageInputs(): Promise<{
  tasks: { id: string; url: string; goal: string }[];
  metadata: Record<string, TaskMetadata>;
  live: Map<string, { source: string; sha256: string }>;
}> {
  const tasks = JSON.parse(
    await readFile("evals/tasks/external-validation-v1.json", "utf8"),
  ) as {
    id: string;
    url: string;
    goal: string;
  }[];
  const metadata = JSON.parse(
    await readFile("evals/external/task-metadata.json", "utf8"),
  ) as Record<string, TaskMetadata>;
  const sources = JSON.parse(
    await readFile(".scratch/external-validation-v1/sources/sources.json", "utf8"),
  ) as {
    live: { url: string; source: string; sha256: string }[];
  };
  return {
    tasks,
    metadata,
    live: new Map(sources.live.map((entry) => [entry.url, entry])),
  };
}

/** Verifies that the archived copy of a live page is byte-identical to the frozen record. */
export async function verifyArchivedLive(
  live: Map<string, { source: string; sha256: string }>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const [url, entry] of live) {
    const candidates = [
      entry.source,
      `.scratch/external-validation-v1/sources/live/${entry.source.split("/").pop()}`,
    ];
    let digest: string | null = null;
    for (const candidate of candidates) {
      try {
        digest = createHash("sha256")
          .update(await readFile(candidate))
          .digest("hex");
        break;
      } catch {
        /* Try the preserved scratch copy. */
      }
    }
    if (digest === null) problems.push(`${url}: no preserved copy of ${entry.source}`);
    else if (digest !== entry.sha256)
      problems.push(
        `${url}: copy hash ${digest.slice(0, 12)}… differs from frozen ${entry.sha256.slice(0, 12)}…`,
      );
  }
  return problems;
}

/** Keeps the observation that exposes the most of the intended control. */
function better<T extends { correct: { matches: number; offered: number } }>(
  current: T | null,
  candidate: T,
): T {
  if (current === null) return candidate;
  const score = (value: T): number =>
    value.correct.offered * 10 + value.correct.matches;
  return score(candidate) > score(current) ? candidate : current;
}

/** Maps a live URL to its archived loopback copy; other URLs are served from the source root. */
export function localUrl(
  url: string,
  base: string,
  live: Map<string, { source: string; sha256: string }>,
): string | null {
  const entry = live.get(url);
  if (entry !== undefined) {
    // The archive path in the frozen record is the original location; the preserved copy
    // lives in the scratch source tree under the same basename.
    return `${base}/live/${entry.source.split("/").pop()}`;
  }
  const parsed = new URL(url);
  if (parsed.origin === "http://127.0.0.1:9842") return `${base}${parsed.pathname}`;
  return null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"),
    options: {
      out: { type: "string", default: "work/endpoint-audit" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9333" },
    },
  });
  const { tasks, metadata, live } = await loadCoverageInputs();
  const problems = await verifyArchivedLive(live);
  const connection = await connectBrowser(parseBrowserUrl(values["browser-url"]!));
  const sources = await startAuditSources();
  const rows = [];
  const unavailable: string[] = [];
  try {
    for (const task of tasks) {
      const url = localUrl(task.url, sources.url, live);
      if (url === null) {
        unavailable.push(`${task.id}: no local copy of ${task.url}`);
        continue;
      }
      const session = await openBrowserSession({
        url,
        client: connection.client,
      });
      try {
        // The external pages are dynamic: the widget scripts run after Page.navigate
        // returns. Observe a bounded number of times and keep the best coverage, exactly
        // as an agent that waits would see it.
        let best: Awaited<ReturnType<typeof inspectTask>> | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const snapshot = await session.observe();
          const coverage = await inspectTask(
            session,
            task,
            metadata[task.id]!,
            snapshot,
          );
          best = better(best, coverage);
          if (best.correct.offered > 0 && best.correct.matches === 1) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        rows.push(best!);
      } finally {
        await session.close();
      }
    }
  } finally {
    await sources.close();
    await connection.close();
  }
  const text = [
    "# P0-C external audit coverage check",
    "",
    "Read-only, zero model calls. Each published source is loaded on loopback; the frozen",
    "oracle selectors are resolved against the live DOM. No page is modified and no task is",
    "re-run.",
    "",
    `- tasks inspected: ${rows.length}/${tasks.length}`,
    `- archived live copies verified against the frozen hashes: ${problems.length === 0 ? "yes" : "no"}`,
    problems.length ? `- archive problems: ${problems.join("; ")}` : null,
    unavailable.length ? `- unavailable: ${unavailable.join("; ")}` : null,
    "",
    classifyCoverage(rows),
    "",
    "`correct matches` is the number of elements the frozen `correct_selector` resolves to.",
    "A value above 1 can be intentional for a multi-step task; inspect the task-stage contract.",
    "UnOffered matches can be hidden controls awaiting a later state, not permanent capability gaps.",
    "`legal ancestor actions` counts offered controls that contain the correct control: the",
    "frozen audit scores those as neutral, so a success through them is not recorded as a",
    "grounding success if an independent activation check shows the goal can be reached.",
    "",
    "### Legal ancestor actions",
    "",
    ...(rows.flatMap((row) =>
      row.legalAncestors.length
        ? [
            `- ${row.taskId}: ${row.legalAncestors
              .map(
                (ancestor) =>
                  `${ancestor.label || "unlabelled"} (node ${ancestor.node})`,
              )
              .join(", ")}`,
          ]
        : [],
    ).length
      ? rows.flatMap((row) =>
          row.legalAncestors.length
            ? [
                `- ${row.taskId}: ${row.legalAncestors
                  .map(
                    (ancestor) =>
                      `${ancestor.label || "unlabelled"} (node ${ancestor.node})`,
                  )
                  .join(", ")}`,
              ]
            : [],
        )
      : ["None."]),
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  await writeFile(`${values.out}/external-coverage.md`, text);
  await writeFile(
    `${values.out}/external-coverage.json`,
    `${JSON.stringify({ generated_at: new Date().toISOString(), rows, problems, unavailable }, null, 2)}\n`,
  );
  console.log(text);
}

if (process.argv[1] && process.argv[1].endsWith("coverage-cli.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
