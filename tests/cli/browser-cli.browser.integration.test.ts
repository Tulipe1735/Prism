import type { BrowserConnection } from "../../src/browser/connect.ts";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";

interface Target {
  ref: string;
  operation: string;
  label: string;
  option_value?: string;
  relations?: { text: string }[];
  context: { local?: string };
}
interface View {
  session: string;
  observation: string;
  evidence: string;
  targets: Target[];
}
interface Reply {
  ok: boolean;
  data: any;
  error?: { code: string };
}
const browserUrl = process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333";
const entry = resolve(process.env.PRISM_CLI_TEST_ENTRY ?? "src/interfaces/cli.ts");

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "external-agent browser CLI (no model calls)",
  () => {
    let directory: string;
    let url: string;
    let connection: BrowserConnection;
    const openedSessions: string[] = [];
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Prism CLI contract test</title>
      <section><h2 id="group">Alpha</h2><article><p>Plan</p><button onclick="window.clicks++; document.querySelector('[role=status]').textContent='Clicks '+window.clicks">Choose</button></article></section>
      <section><h2 id="noise">Unrelated</h2><p>Other area</p></section>
      <form><label>Name <input id="name"></label><label>Region <select id="region"><option value="eu">Europe</option><option value="us">America</option></select></label></form>
      <p role="status">Ready</p><div style="height:1800px"></div><script>window.clicks=0</script>`);
    });
    async function cli(args: string[], input?: string): Promise<Reply> {
      const runtime = entry.endsWith(".ts")
        ? ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
        : [];
      return new Promise((resolveReply, reject) => {
        const child = execFile(
          process.execPath,
          [...runtime, entry, ...args, "--state-dir", directory],
          {
            timeout: 40_000,
            maxBuffer: 2_000_000,
            env: { ...process.env, TYPESAFE_API_KEY: "", TEXT_MODEL_API_KEY: "" },
          },
          (error, stdout, stderr) => {
            try {
              const reply = JSON.parse(stdout.trim()) as Reply;
              resolveReply(reply);
            } catch {
              reject(
                new Error(`${error?.message ?? "Invalid reply"}\n${stdout}\n${stderr}`),
              );
            }
          },
        );
        if (input !== undefined) child.stdin!.end(input);
      });
    }
    async function inspect(expression: string) {
      const targets = await connection.client.send("Target.getTargets");
      const target = targets.targetInfos.find(
        (item: { url: string }) => item.url === url,
      );
      if (!target) throw new Error("Owned test tab not found");
      const attached = await connection.client.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      try {
        const response = await connection.client.send(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          attached.sessionId,
        );
        if (response.exceptionDetails)
          throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
      } finally {
        await connection.client.send("Target.detachFromTarget", {
          sessionId: attached.sessionId,
        });
      }
    }
    async function openSession(): Promise<string> {
      const reply = await cli([
        "session",
        "open",
        "--url",
        url,
        "--browser-url",
        browserUrl,
      ]);
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      openedSessions.push(reply.data.session);
      return reply.data.session;
    }
    async function observe(session: string, scope = "local"): Promise<View> {
      const reply = await cli(["observe", "--session", session, "--scope", scope]);
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      return reply.data;
    }
    function action(
      view: View,
      target: Target,
      request: string,
      evidence = view.evidence,
      value?: string,
    ) {
      return {
        command: "act",
        session: view.session,
        observation: view.observation,
        target: target.ref,
        evidence,
        operation: target.operation,
        request_id: request,
        ...(value !== undefined ? { value } : {}),
      };
    }
    async function act(command: object) {
      return cli(["act", "--stdin"], JSON.stringify(command));
    }

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "prism-cli-browser-"));
      await new Promise<void>((resolveListen) =>
        server.listen(0, "127.0.0.1", resolveListen),
      );
      const address = server.address() as { port: number };
      url = `http://127.0.0.1:${address.port}/`;
      connection = await connectBrowser(parseBrowserUrl(browserUrl));
    });
    afterEach(async () => {
      for (const session of openedSessions.splice(0))
        await cli(["session", "close", "--session", session]);
    });
    afterAll(async () => {
      if (directory) await cli(["daemon", "stop"]).catch(() => {});
      await connection?.close();
      const closing = new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      server.closeAllConnections();
      await closing;
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("runs fill/select/click across short-lived commands and deduplicates concurrent input", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find((item) => item.operation === "fill")!;
      expect(
        (await act(action(view, target, "fill1", view.evidence, "Ada"))).data.receipt
          .outcome,
      ).toBe("executed");
      expect(await inspect("document.querySelector('#name').value")).toBe("Ada");
      const expired = await act(action(view, target, "expired", view.evidence, "Bad"));
      expect(expired.error?.code).toBe("OBSERVATION_EXPIRED");
      view = await observe(session);
      target = view.targets.find(
        (item) => item.operation === "select" && item.option_value === "us",
      )!;
      expect(target).toBeDefined();
      expect((await act(action(view, target, "select1"))).data.receipt.outcome).toBe(
        "executed",
      );
      expect(await inspect("document.querySelector('#region').value")).toBe("us");
      view = await observe(session, "structural");
      target = view.targets.find(
        (item) => item.operation === "click" && item.label === "Choose",
      )!;
      const command = action(view, target, "click1");
      const replies = await Promise.all([act(command), act(command)]);
      expect(replies.every((reply) => reply.data.receipt.outcome === "executed")).toBe(
        true,
      );
      expect(replies.map((reply) => reply.data.replayed).sort()).toEqual([false, true]);
      expect(await inspect("window.clicks")).toBe(1);
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "wait")!;
      expect((await act(action(view, target, "wait1"))).data.receipt.code).toBe(
        "WAIT_COMPLETED",
      );
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "scroll")!;
      expect((await act(action(view, target, "scroll1"))).data.receipt.outcome).toBe(
        "executed",
      );
      await observe(session); // Uses the executor's post-input settling policy.
      await expect
        .poll(() => inspect("window.scrollY"), { timeout: 2000 })
        .toBeGreaterThan(0);
      expect((await cli(["session", "close", "--session", session])).ok).toBe(true);
      expect(
        (await cli(["receipt", "--session", session, "--request-id", "click1"])).data
          .receipt.outcome,
      ).toBe("executed");
    });

    it("refuses changed relation evidence on a fresh target but tolerates unrelated page changes", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find((item) => item.operation === "click")!;
      expect(target.context.local).toBe("Plan");
      const context = await cli([
        "context",
        "--session",
        session,
        "--observation",
        view.observation,
        "--target",
        target.ref,
        "--scope",
        "relations",
      ]);
      expect(
        context.data.relations.map((item: { text: string }) => item.text),
      ).toContain("Alpha");
      await inspect("document.querySelector('#group').textContent='Beta'");
      const reply = await act(
        action(view, target, "stale-relation", context.data.evidence),
      );
      expect(reply).toMatchObject({
        ok: false,
        error: { code: "EVIDENCE_CHANGED" },
        data: { receipt: { outcome: "not_executed" } },
      });
      expect(await inspect("window.clicks")).toBe(0);
      view = await observe(session, "relations");
      target = view.targets.find((item) => item.operation === "click")!;
      expect(target.relations!.map((item) => item.text)).toContain("Beta");
      await inspect("document.querySelector('#noise').textContent='Updated elsewhere'");
      expect(
        (await act(action(view, target, "fresh-relation"))).data.receipt.outcome,
      ).toBe("executed");
      expect(await inspect("window.clicks")).toBe(1);
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "click")!;
      await inspect("document.querySelector('#group').textContent='Gamma'");
      expect(
        (await act(action(view, target, "local-does-not-bind-group"))).data.receipt
          .outcome,
      ).toBe("executed");
      expect(await inspect("window.clicks")).toBe(2);
      await cli(["session", "close", "--session", session]);
    });

    it("expires old refs on re-observation and keeps receipts readable after broker shutdown", async () => {
      const session = await openSession();
      const old = await observe(session);
      let latest = await observe(session);
      expect(
        (
          await act(
            action(
              old,
              old.targets.find((item) => item.operation === "click")!,
              "old-view",
            ),
          )
        ).error?.code,
      ).toBe("OBSERVATION_EXPIRED");
      await inspect(
        "document.querySelector('button').replaceWith(document.querySelector('button').cloneNode(true))",
      );
      expect(
        (
          await act(
            action(
              latest,
              latest.targets.find((item) => item.operation === "click")!,
              "replaced-node",
            ),
          )
        ).error?.code,
      ).toBe("TARGET_CHANGED");
      expect(await inspect("window.clicks")).toBe(0);
      latest = await observe(session);
      expect(
        (
          await act(
            action(
              latest,
              latest.targets.find((item) => item.operation === "click")!,
              "durable",
            ),
          )
        ).data.receipt.outcome,
      ).toBe("executed");
      expect((await cli(["daemon", "stop"])).ok).toBe(true);
      const reply = await cli([
        "receipt",
        "--session",
        session,
        "--request-id",
        "durable",
      ]);
      expect(reply.data.receipt.outcome).toBe("executed");
      const targets = await connection.client.send("Target.getTargets");
      expect(
        targets.targetInfos.filter((item: { url: string }) => item.url === url),
      ).toHaveLength(0);
    });
  },
);
