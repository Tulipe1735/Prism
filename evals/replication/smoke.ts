import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { sessionHeaders } from "../../src/runtime/text-helper.ts";
import { postJson } from "../../src/shared/http.ts";
import { digest, SYSTEM_PROMPT } from "../runners/model.ts";
import { cohortSchema } from "../schema.ts";
import { BROWSER_URL, ID, PREFIX, verifyConfirmatoryFreeze } from "./controls.ts";

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* Environment may already be configured. */
  }
  const cohort = cohortSchema.parse(
    JSON.parse(await readFile(`${PREFIX}.json`, "utf8")),
  );
  const connection = await connectBrowser(parseBrowserUrl(BROWSER_URL));
  try {
    const browser = await connection.client.send("Browser.getVersion");
    await verifyConfirmatoryFreeze(cohort, browser, BROWSER_URL);
    const input = {
      goal: "Finish when the supplied page status is Ready.",
      page: { url: "about:blank", title: "Connectivity smoke", text: "Ready" },
      dom: null,
      dom_truncated: false,
      target_mode: "indexed",
      targets: {},
      operations: { DONE: "Finish" },
      history: [],
    };
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ];
    const body = {
      model: cohort.model,
      temperature: cohort.temperature,
      top_p: cohort.topP,
      max_tokens: cohort.maxTokens,
      response_format: { type: "json_object" },
      messages,
    };
    const path = `evals/reports/${ID}-smoke.json`;
    await writeFile(
      path,
      `${JSON.stringify({
        status: "started",
        started_at: new Date().toISOString(),
        request: body,
        request_hash: digest(JSON.stringify(body)),
        benchmark_runs: 0,
      })}\n`,
      { flag: "wx" },
    );
    // One request, no performance tuning or smoke retry.
    const response: any = await postJson({
      url: `${cohort.baseUrl}/chat/completions`,
      apiKey: process.env[cohort.apiKeyEnv]!,
      body,
      headers: sessionHeaders(cohort.baseUrl, `${ID}-connectivity`),
      timeoutMs: 120000,
      maxAttempts: 1,
      label: "Replication connectivity smoke",
    });
    let content: any;
    try {
      content = JSON.parse(response?.choices?.[0]?.message?.content);
    } catch {
      content = null;
    }
    const compatible =
      response.model === cohort.model &&
      content?.operation?.choice === "DONE" &&
      content?.operation?.probabilities?.DONE === 1 &&
      typeof content?.operation?.confidence === "number" &&
      content?.target === null &&
      content?.text === null;
    await writeFile(
      path,
      `${JSON.stringify(
        {
          status: compatible ? "passed" : "incompatible",
          finished_at: new Date().toISOString(),
          request: body,
          request_hash: digest(JSON.stringify(body)),
          response,
          benchmark_runs: 0,
        },
        null,
        2,
      )}\n`,
    );
    if (!compatible)
      throw new Error(
        "Connectivity smoke incompatible; no prompt/settings change and no cohort started.",
      );
    console.log(
      `One neutral smoke passed; returned model=${response.model}; output tokens=${response.usage?.completion_tokens}.`,
    );
  } finally {
    await connection.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
