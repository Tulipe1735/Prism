import type { TaskMetadata } from "./audit.ts";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";
import { resolveSelector } from "../runners/model.ts";
import { parseTasks } from "../schema.ts";
import { evaluateSuccess, readEvidence } from "../success.ts";
import { startExternalSources } from "./server.ts";

async function knownBrowserInput(
  session: Awaited<ReturnType<typeof openBrowserSession>>,
  instruction: TaskMetadata["browser_check"][number],
): Promise<void> {
  // Independent browser oracle check: human-operable controls can be absent from
  // Prism's offered action space. Verify the task without expanding that action space.
  let rect: any;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await session.call("Runtime.evaluate", {
      expression: `(() => { const e=document.querySelector(${JSON.stringify(instruction.selector)});
        if(!e || e.matches(':disabled') || !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;
        e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
      returnByValue: true,
    });
    rect = response.result?.value;
    if (rect) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!rect) throw new Error("Known human control unavailable");
  if (instruction.kind === "select") {
    await session.call("Runtime.evaluate", {
      expression: `(() => {const e=document.querySelector(${JSON.stringify(instruction.selector)});e.value=${JSON.stringify(instruction.value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      returnByValue: true,
    });
  } else {
    for (const type of ["mousePressed", "mouseReleased"])
      await session.call("Input.dispatchMouseEvent", {
        type,
        ...rect,
        button: "left",
        clickCount: 1,
      });
    if (instruction.kind === "fill") {
      await session.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: 2,
        commands: ["selectAll"],
      });
      await session.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: 2,
      });
      await session.call("Input.insertText", { text: instruction.text });
    }
  }
  await new Promise((done) => setTimeout(done, 250));
}

async function main(): Promise<void> {
  const tasks = parseTasks(
    JSON.parse(await readFile("evals/tasks/external-validation-v1.json", "utf8")),
  );
  const metadata: Record<string, TaskMetadata> = JSON.parse(
    await readFile("evals/external/task-metadata.json", "utf8"),
  );
  const server = await startExternalSources();
  const connection = await connectBrowser(parseBrowserUrl("http://127.0.0.1:9334"));
  const records: any[] = [];
  try {
    for (const task of tasks) {
      const session = await openBrowserSession({
        url: task.url,
        client: connection.client,
      });
      const record: any = {
        task_id: task.id,
        initial_satisfied: false,
        passed: false,
        steps: [],
        error: null,
      };
      try {
        record.initial_satisfied = evaluateSuccess(
          await readEvidence(session, task.success),
          task.success,
        );
        if (record.initial_satisfied)
          throw new Error("Task goal already satisfied at initial state");
        for (const instruction of metadata[task.id]!.browser_check) {
          if (instruction.kind === "wait") {
            await new Promise((done) => setTimeout(done, instruction.ms));
            continue;
          }
          let executed = false;
          let lastError;
          for (let scroll = 0; scroll < 8 && !executed; scroll++) {
            const snapshot = await session.observe();
            try {
              const operation = { fill: "TYPE_TEXT", select: "SELECT", click: "CLICK" }[
                instruction.kind
              ]!;
              const action = await resolveSelector(
                session,
                snapshot,
                instruction.selector!,
                operation,
                instruction.value ?? null,
              );
              await session.act(action, snapshot, instruction.text ?? null);
              record.steps.push(instruction);
              executed = true;
            } catch (error) {
              lastError = error;
              const down = snapshot.actions.find(
                (a) => a.kind === "scroll" && (a.delta ?? 0) > 0,
              );
              if (!down) break;
              await session.act(down, snapshot);
            }
          }
          if (!executed) {
            record.steps.push({
              ...instruction,
              prism_eligible: false,
              eligibility_error:
                lastError instanceof Error ? lastError.message : String(lastError),
            });
            await knownBrowserInput(session, instruction);
          }
          await session.observe();
        }
        record.evidence = await readEvidence(session, task.success);
        record.passed = evaluateSuccess(record.evidence, task.success);
        if (!record.passed)
          record.error =
            "Independent success checks failed after known correct interaction";
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        record.evidence = await readEvidence(session, task.success).catch(() => null);
      } finally {
        await session.close();
      }
      records.push(record);
      console.log(
        `${task.id}: ${record.passed ? "PASS" : "FAIL"} ${record.error ?? ""}`,
      );
    }
    await writeFile(
      "evals/reports/external-validation-v1-browser-preflight.json",
      `${JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          live_model_calls: 0,
          browser: await connection.client.send("Browser.getVersion"),
          records,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await connection.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
