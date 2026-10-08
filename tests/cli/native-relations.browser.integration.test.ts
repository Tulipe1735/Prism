import type { BrowserConnection } from "../../src/browser/connect.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { captureEvidence, targetEvidence } from "../../src/browser/evidence.ts";
import { openBrowserSession } from "../../src/browser/session.ts";

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "native public group relations",
  () => {
    let connection: BrowserConnection;
    let session: BrowserSession;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Public groups</title>
      <style>fieldset {margin:0} .across {display:flex;gap:10px} .down {display:flex;flex-direction:column;align-items:flex-start;gap:10px}</style>
      <fieldset><legend>Delivery</legend><div class="across"><button>A</button><button>B</button></div></fieldset>
      <fieldset><legend>Delivery</legend><div class="down"><button>C</button><button>D</button></div></fieldset>
      <section aria-labelledby="public-name"><h2 id="public-name">Stock</h2><article><button>E</button></article></section>
      <p style="font-weight:700">Pending requests</p><div><label>Find <input aria-controls="pending"></label><table id="pending"><tbody><tr><td>Robin</td><td><a href="#">Edit</a></td></tr><tr><td>Morgan</td><td><a href="#">Edit</a></td></tr></tbody></table></div>
      <div><label>Lookup <input aria-controls="archived"></label><table id="archived"><caption>Archived requests</caption><tbody><tr><td>Closed</td></tr></tbody></table></div>
      <section><h2>Multiple lists</h2><input aria-label="Common"><table><caption>First</caption><tbody><tr><td>1</td></tr></tbody></table><table><caption>Second</caption><tbody><tr><td>2</td></tr></tbody></table></section>
      <section aria-labelledby="hidden-name"><span hidden id="hidden-name">Secret group</span><button>F</button></section>
      <section><div><table><caption>Separate list</caption><tbody><tr><td>Old</td></tr></tbody></table></div><div><button>Unrelated sibling</button></div></section>
      <div><h2>Overview</h2><table><caption>Active orders</caption><tr><td><div><button>Review active</button></div></td></tr></table><h2>Overview</h2><table><caption>Old orders</caption><tr><td><div><button>Review old</button></div></td></tr></table></div>
      <h2>Issued permits</h2><div><div><button>Emergency help</button></div><table><caption>Issued permits</caption><tr><td><div><button>Renew</button></div></td></tr></table></div>
      <section><p>No service has been assigned to these controls.</p><div><button>Inspect</button></div></section>
      <article><strong>Descriptive prose</strong><div><button>Continue</button></div></article>
      <section aria-labelledby="outer"><h2 id="outer">Workspace</h2><div role="group" aria-labelledby="inner"><h3 id="inner">Queue</h3><div><button>Process</button></div></div></section>
      <div><h2>Left team</h2><h2>Right team</h2><div><button>Unassigned</button></div></div>
      <div><button>Table neighbor</button><table><caption>Account ledger</caption><thead><tr><th scope="col"><button>Sort account</button></th><th scope="col"><button>Sort balance</button></th></tr></thead><tbody>
      <tr><th scope="row">Primary account</th><td><div><button>Open primary</button></div></td></tr>
      <tr><th scope="row">Secondary account</th><td><div><button>Open secondary</button></div></td></tr>
      <tr><th>Unscoped header</th><td><div><button>Open unassigned</button></div></td></tr>
      <tr><th scope="row">First owner</th><th scope="row">Second owner</th><td><div><button>Open ambiguous</button></div></td></tr>
      <tr><th scope="row">Outer owner</th><td><table><caption>Inner ledger</caption><tr><td><div><button>Nested action</button></div></td></tr></table></td></tr>
      </tbody></table></div>
      <button>Outside</button>`);
    });
    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      connection = await connectBrowser(
        parseBrowserUrl(process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333"),
      );
      session = await openBrowserSession({
        client: connection.client,
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
      });
      await session.call("Emulation.setDeviceMetricsOverride", {
        width: 1120,
        height: 4000,
        deviceScaleFactor: 1,
        mobile: false,
      });
    });
    afterAll(async () => {
      await session?.close();
      await connection?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    async function targets() {
      const capture = await captureEvidence(session);
      return capture.snapshot.actions.map((action) => ({
        ...action,
        ...targetEvidence(
          action,
          "relations",
          capture.contexts[String(action.node)],
          capture.relations[String(action.node)],
        ),
      }));
    }
    it("inherits legends and rendered orientation for repeated public groups", async () => {
      const offered = await targets();
      expect(offered.find((t) => t.label === "A")?.relations).toContainEqual({
        text: "Delivery",
        scope: "fieldset",
        layout: "horizontal",
      });
      expect(offered.find((t) => t.label === "C")?.relations).toContainEqual({
        text: "Delivery",
        scope: "fieldset",
        layout: "vertical",
      });
      expect(offered.find((t) => t.label === "E")?.relations).toContainEqual({
        text: "Stock",
        scope: "section",
      });
    });
    it("associates external table controls with visible headings or captions and preserves rows", async () => {
      const offered = await targets();
      expect(
        offered.find((t) => t.kind === "fill" && t.label === "Find")?.relations,
      ).toContainEqual({ text: "Pending requests", scope: "table-region" });
      expect(
        offered.find((t) => t.kind === "fill" && t.label === "Lookup")?.relations,
      ).toContainEqual({ text: "Archived requests", scope: "table-region" });
      const edits = offered.filter((t) => t.label === "Edit");
      expect(edits.map((t) => t.context.local)).toEqual(["Robin", "Morgan"]);
      expect(
        edits.every((t) => t.relations?.some((r) => r.text === "Pending requests")),
      ).toBe(true);
    });
    it("does not invent table identity for multi-table groups or unrelated controls, or expose hidden names", async () => {
      const offered = await targets();
      expect(
        offered
          .find((t) => t.label === "Common")
          ?.relations?.some((r) => r.scope === "table-region"),
      ).toBe(false);
      expect(offered.find((t) => t.label === "Outside")?.relations).toEqual([]);
      expect(offered.find((t) => t.label === "Unrelated sibling")?.relations).toEqual(
        [],
      );
      expect(JSON.stringify(offered)).not.toContain("Secret group");
    });
    it("prefers owned captions and rejects wrapper membership and prose identity", async () => {
      const offered = await targets();
      expect(offered.find((t) => t.label === "Review active")?.relations).toEqual([
        { text: "Active orders", scope: "table-region" },
      ]);
      expect(offered.find((t) => t.label === "Review old")?.relations).toEqual([
        { text: "Old orders", scope: "table-region" },
      ]);
      expect(offered.find((t) => t.label === "Renew")?.relations).toEqual([
        { text: "Issued permits", scope: "table-region" },
      ]);
      for (const label of ["Emergency help", "Inspect", "Continue", "Unassigned"])
        expect(offered.find((t) => t.label === label)?.relations).toEqual([]);
      expect(offered.find((t) => t.label === "Process")?.relations).toEqual([
        { text: "Workspace", scope: "section" },
        { text: "Queue", scope: "group" },
      ]);
    });
    it("limits implicit header identity to a unique explicit owner of the same row", async () => {
      const offered = await targets();
      for (const label of [
        "Sort account",
        "Sort balance",
        "Open unassigned",
        "Open ambiguous",
      ])
        expect(offered.find((t) => t.label === label)?.relations).toEqual([
          { text: "Account ledger", scope: "table-region" },
        ]);
      for (const [label, owner] of [
        ["Open primary", "Primary account"],
        ["Open secondary", "Secondary account"],
      ])
        expect(offered.find((t) => t.label === label)?.relations).toEqual([
          { text: "Account ledger", scope: "table-region" },
          { text: owner, scope: "row" },
        ]);
      expect(offered.find((t) => t.label === "Nested action")?.relations).toEqual([
        { text: "Inner ledger", scope: "table-region" },
      ]);
      expect(offered.find((t) => t.label === "Table neighbor")?.relations).toEqual([]);
    });
    it("is deterministic and ignores goal text outside the rendered page", async () => {
      const first = await targets();
      await session.call("Runtime.evaluate", {
        expression:
          "window.taskGoal='Choose a different group'; window.oracleMapping={answer:'Other'}",
      });
      expect(await targets()).toEqual(first);
      const production = readFileSync(
        new URL("../../src/browser/representation.ts", import.meta.url),
        "utf8",
      );
      for (const name of [
        "Rental Car",
        "Gecko",
        "Iuvaret2",
        "h71-addresses",
        "taskGoal",
        "oracleMapping",
      ])
        expect(production).not.toContain(name);
    });
  },
);
