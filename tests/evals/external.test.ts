import type { TaskMetadata } from "../../evals/external/audit.ts";
import type { CdpClient } from "../../src/browser/connect.ts";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { externalAudit, externalFailure } from "../../evals/external/audit.ts";
import { cellKey } from "../../evals/external/cohort.ts";
import { design } from "../../evals/external/controls.ts";
import { schedule } from "../../evals/runners/cohort.ts";

describe("external validation evaluation controls", () => {
  it("has 360 unique model-specific cells and no synthetic minimum-scope annotations", async () => {
    const { models, tasks } = await design();
    const cells = models.flatMap((model: any) =>
      schedule(tasks, model).map((p) =>
        cellKey(model.model, { task_id: p.task.id, ...p }),
      ),
    );
    expect(cells).toHaveLength(360);
    expect(new Set(cells).size).toBe(360);
    expect(
      tasks.every((t) => t.preregistered === undefined && t.fixture === undefined),
    ).toBe(true);
  });

  it("keeps task audit selectors outside standard model task definitions", async () => {
    const tasks = JSON.parse(
      await readFile("evals/tasks/external-validation-v1.json", "utf8"),
    );
    const metadata = JSON.parse(
      await readFile("evals/external/task-metadata.json", "utf8"),
    );
    expect(Object.keys(metadata).sort()).toEqual(tasks.map((t: any) => t.id).sort());
    expect(JSON.stringify(tasks)).not.toMatch(
      /correct_selector|candidate_selector|browser_check|minimum_level|ambiguity_class/,
    );
  });

  it("counts actual wrong executions monotonically without changing DOM or input commands", async () => {
    const sent: any[] = [];
    let assessment = "wrong";
    const client: CdpClient = {
      async send(method, params) {
        sent.push({ method, params });
        const expression = (params as any)?.expression ?? "";
        if (expression.includes("return 'correct'"))
          return { result: { value: assessment } };
        if (expression === "oracle") return { result: { value: { checks: [] } } };
        return {};
      },
    };
    const metadata: TaskMetadata = {
      page_type: "form",
      source_family: "test",
      planned_minimum_steps: 1,
      goal_characters: 4,
      correct_selector: "#wanted",
      candidate_selector: "button",
      browser_check: [],
    };
    const audit = externalAudit(client, metadata);
    const target =
      "(() => { const el=window.__jevFast.nodes.get(7); if(el.hasAttribute('data-correct')) return 'correct'; })()";
    await audit.client.send("Runtime.evaluate", { expression: target }, "owned-tab");
    expect(audit.wrong()).toBe(0); // A stale or unexecuted selection is not an execution.
    const click = {
      type: "mouseReleased",
      x: 12,
      y: 20,
      button: "left",
      clickCount: 1,
    };
    await audit.client.send("Input.dispatchMouseEvent", click, "owned-tab");
    expect(audit.wrong()).toBe(1);
    assessment = "correct";
    await audit.client.send("Runtime.evaluate", { expression: target }, "owned-tab");
    await audit.client.send("Input.dispatchMouseEvent", click, "owned-tab");
    expect(audit.wrong()).toBe(1); // Repair never erases a wrong action.
    expect(
      (await audit.client.send("Runtime.evaluate", { expression: "oracle" })).result
        .value.wrong_targets,
    ).toBe(1);
    expect(
      sent.filter((s) => s.method === "Input.dispatchMouseEvent").map((s) => s.params),
    ).toEqual([click, click]);
    expect(JSON.stringify(sent)).not.toMatch(
      /setAttribute|addEventListener|preventDefault/,
    );
  });

  it("separates concrete network failures from unobserved grounding", () => {
    const failure = {
      success: false,
      reason: "Document is navigating",
      failure_type: "OBSERVATION_ERROR",
    };
    expect(
      externalFailure(
        [],
        failure,
        [],
        ["NETWORK_DEPENDENCY: net::ERR_CONNECTION_RESET"],
      ),
    ).toEqual({ domain: "environment", category: "NETWORK_DEPENDENCY" });
    expect(externalFailure([], failure, []).domain).toBe("unresolved");
  });
});
