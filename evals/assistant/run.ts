import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../../src/assistant/config.ts";
import { DeepSeekModel } from "../../src/assistant/deepseek.ts";
import { AssistantRuntime } from "../../src/assistant/runtime.ts";
import { AssistantStore } from "../../src/assistant/store.ts";

// Fixed evidence and rubric are written before either paid run starts. Ratings
// remain null until a human checks the reports against the frozen evidence.
const rubric = [
  "方法覆盖：是否找到处理相同问题的替代路线",
  "差异准确性：机制与假设是否忠实于资料",
  "比较条件：实验、成本与不可比因素是否明确",
  "引用正确性：关键结论能否由具体资料位置支持",
];
const fixtureSchema = z.object({
  question: z.string().min(1),
  documents: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.url(),
        content: z.string().min(1),
        version: z.string(),
      }),
    )
    .min(1),
  state: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
});
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { fixture: { type: "string" }, output: { type: "string" } },
    strict: true,
  });
  if (!values.fixture || !values.output)
    throw new Error(
      "用法：pnpm eval:assistant --fixture snapshot.json --output .scratch/eval-日期（会调用付费模型）",
    );
  const config = loadConfig();
  if (!config.deepseek.apiKey) throw new Error("请设置 DEEPSEEK_API_KEY");
  const raw = await readFile(resolve(values.fixture), "utf8");
  const fixture = fixtureSchema.parse(JSON.parse(raw));
  const directory = resolve(values.output);
  await mkdir(directory, { recursive: false });
  const conditions = {
    model: config.deepseek.model,
    snapshotSha256: createHash("sha256").update(raw).digest("hex"),
    question: fixture.question,
    networkSources: false,
    rubric,
    scoring: "每项0/1/2分，人工依据快照核对；必须同时保留改进和退步。",
    pricing: {
      input: config.deepseek.input,
      output: config.deepseek.output,
      cacheHit: config.deepseek.cacheHit,
    },
  };
  await writeFile(
    resolve(directory, "conditions.json"),
    JSON.stringify(conditions, null, 2),
  );
  await writeFile(resolve(directory, "snapshot.json"), raw);
  // Share the production budget ledger so evaluation cannot evade the month cap.
  const budgetStore = new AssistantStore(config.directory, {
    budgetCny: config.budgetCny,
    infrastructureCny: config.infrastructureCny,
  });
  const store = new AssistantStore(resolve(directory, "data"), {
    budgetCny: config.budgetCny,
    infrastructureCny: config.infrastructureCny,
  });
  try {
    for (const doc of fixture.documents)
      store.upsertDocument({
        ...doc,
        id: `eval:${conditions.snapshotSha256}:${doc.id}`,
        source: "file",
        updatedAt: new Date().toISOString(),
        metadata: { evaluation: true },
      });
    const originalMemory = store.listMemory();
    const records = [];
    for (const effort of ["normal", "deep"] as const) {
      const started = Date.now();
      // Restrict retrieval and mutable memory to the same evidence snapshot. The
      // wrapper delegates real persistence/budget while hiding unrelated sources.
      const ids = new Set(
        fixture.documents.map((d) => `eval:${conditions.snapshotSha256}:${d.id}`),
      );
      const evalMemory = fixture.state.map((entry) => ({
        ...entry,
        kind: "progress" as const,
        status: "confirmed" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      const scopedStore = new Proxy(store, {
        get(target, key) {
          if (key === "listMemory") return () => evalMemory;
          if (key === "upsertMemory" || key === "deleteMemory")
            return () => {
              throw new Error("固定评测不修改共享状态");
            };
          if (key === "listDocuments")
            return () => target.listDocuments().filter((d) => ids.has(d.id));
          if (key === "getDocument")
            return (id: string) => (ids.has(id) ? target.getDocument(id) : undefined);
          if (key === "search")
            return (query: string, limit = 8) =>
              target
                .search(query, 200)
                .filter((c) => ids.has(c.documentId))
                .slice(0, limit);
          if (
            ["budget", "reserveBudget", "settleBudget", "releaseReservation"].includes(
              String(key),
            )
          ) {
            const method: unknown = Reflect.get(budgetStore, key, budgetStore);
            return typeof method === "function" ? method.bind(budgetStore) : method;
          }
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const runtime = new AssistantRuntime({
        store: scopedStore,
        model: new DeepSeekModel(config.deepseek),
        pricing: conditions.pricing,
      });
      const task = await runtime.ask({
        message: fixture.question,
        effort,
        conversationId: `eval:${conditions.snapshotSha256}:${effort}`,
        source: "evaluation",
      });
      await writeFile(
        resolve(directory, `${effort}.json`),
        JSON.stringify(task, null, 2),
      );
      await writeFile(resolve(directory, `${effort}.md`), task.answer);
      records.push({
        effort,
        taskId: task.id,
        status: task.status,
        elapsedMs: Date.now() - started,
        usage: task.usage,
        costCny: task.costCny,
        citationCount: task.citations.length,
        scores: rubric.map((dimension) => ({ dimension, score: null, evidence: "" })),
        improvements: [],
        regressions: [],
      });
    }
    // This is an assertion about the evaluator, never a quality score.
    if (JSON.stringify(store.listMemory()) !== JSON.stringify(originalMemory))
      throw new Error("评测意外修改了个人共享状态");
    await writeFile(
      resolve(directory, "comparison.json"),
      JSON.stringify({ conditions, records, actualBillVerified: false }, null, 2),
    );
    console.log(`报告已保存：${directory}；请按预先记录的rubric核对两份成果。`);
  } finally {
    store.close();
    budgetStore.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "评测失败");
  process.exitCode = 1;
});
