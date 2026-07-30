"use client";

import {
  Activity,
  ArrowRight,
  Bot,
  Braces,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Code2,
  Command,
  FileCode2,
  FolderGit2,
  Gauge,
  GitBranch,
  History,
  ListFilter,
  Menu,
  MoreHorizontal,
  OctagonPause,
  PanelLeft,
  Pause,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Timer,
  Waypoints,
  Zap,
} from "lucide-react";
import { useState } from "react";

const stages = [
  { label: "Classify", state: "done", runtime: "ORCH", time: "0.4s" },
  { label: "Baseline", state: "done", runtime: "BROWSER", time: "3.8s" },
  { label: "Inspect", state: "done", runtime: "CODING", time: "5.2s" },
  { label: "Patch", state: "done", runtime: "CODING", time: "9.1s" },
  { label: "Test", state: "done", runtime: "CODING", time: "4.6s" },
  { label: "Verify", state: "active", runtime: "BROWSER", time: "2.7s" },
  { label: "Complete", state: "queued", runtime: "ORCH", time: "—" },
];

const events = [
  {
    time: "09:42:18",
    source: "browser",
    title: "Verification started",
    detail: "Comparing button geometry against baseline observation.",
  },
  {
    time: "09:42:15",
    source: "coding",
    title: "Tests passed",
    detail: "pnpm test — 14 passed in 4.6s",
  },
  {
    time: "09:42:10",
    source: "coding",
    title: "Patch committed",
    detail: "Button.module.css · 1 line changed",
  },
  {
    time: "09:42:01",
    source: "orchestrator",
    title: "Effect lease granted",
    detail: "workspace.patch · fence #018",
  },
];

const runs = [
  { id: "PR-2048", title: "Round the Save button", status: "Verifying" },
  { id: "PR-2047", title: "Restore card shadow", status: "Passed" },
  { id: "PR-2046", title: "Repair profile dialog", status: "Passed" },
  { id: "PR-2045", title: "Fix checkout overflow", status: "Blocked" },
];

function PrismMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`prism-mark ${compact ? "compact" : ""}`} aria-label="Prism">
      <span className="prism-glyph">
        <i />
        <i />
        <i />
      </span>
      <span className="prism-word">
        PRISM
        {!compact && <small>VISUAL SWE HARNESS</small>}
      </span>
    </div>
  );
}

function StatusPill({
  children,
  tone = "blue",
}: {
  children: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "neutral";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function ArtifactPreview({ paper = false }: { paper?: boolean }) {
  return (
    <div className={`artifact-preview ${paper ? "paper" : ""}`}>
      <div className="browser-chrome">
        <span />
        <span />
        <span />
        <p>fixture.local/profile</p>
      </div>
      <div className="fixture-canvas">
        <div className="fixture-card">
          <span className="avatar" />
          <div>
            <b>Account settings</b>
            <small>Changes are saved to your profile.</small>
          </div>
          <button>Save changes</button>
        </div>
        <span className="measure-line top">24 px radius</span>
        <span className="measure-line bottom">height unchanged · 40 px</span>
      </div>
    </div>
  );
}

function PromptComposer({
  onRun,
  dark = false,
}: {
  onRun: () => void;
  dark?: boolean;
}) {
  const [prompt, setPrompt] = useState(
    "Make the primary Save button clearly rounded instead of square",
  );

  return (
    <div className={`prompt-composer ${dark ? "dark" : ""}`}>
      <Sparkles size={16} />
      <input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label="Repair request"
      />
      <button onClick={onRun} title="Start mock run">
        <Send size={15} />
        <span>Run</span>
      </button>
    </div>
  );
}

function VariantA({
  paused,
  setPaused,
  notify,
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const [runFilter, setRunFilter] = useState("All runs");

  return (
    <main className="variant-a">
      <aside className="a-sidebar">
        <PrismMark compact />
        <nav>
          <button className="active" title="Runs">
            <Waypoints size={18} />
            <span>Runs</span>
          </button>
          <button title="Evaluations">
            <Gauge size={18} />
            <span>Evaluations</span>
          </button>
          <button title="Artifacts">
            <Braces size={18} />
            <span>Artifacts</span>
          </button>
          <button title="History">
            <History size={18} />
            <span>Replay</span>
          </button>
        </nav>
        <button className="a-settings" title="Settings">
          <Settings2 size={18} />
          <span>Settings</span>
        </button>
      </aside>

      <section className="a-main">
        <header className="a-topbar">
          <div>
            <button className="icon-button mobile-menu" title="Open navigation">
              <Menu size={18} />
            </button>
            <span className="eyebrow">ACTIVE RUN</span>
            <h1>
              PR-2048 <i /> Round the Save button
            </h1>
          </div>
          <div className="top-actions">
            <StatusPill>HYBRID</StatusPill>
            <button
              className="secondary-button"
              onClick={() => {
                setPaused(!paused);
                notify(paused ? "Run resumed" : "Run paused");
              }}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="icon-button" title="More actions">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>

        <div className="a-scroll">
          <PromptComposer onRun={() => notify("Mock run queued")} />

          <section className="metric-strip">
            <div>
              <small>Run state</small>
              <strong className="live-value">
                <span /> {paused ? "Paused" : "Verifying"}
              </strong>
            </div>
            <div>
              <small>Elapsed</small>
              <strong>00:31.4</strong>
            </div>
            <div>
              <small>Tokens</small>
              <strong>18,420</strong>
            </div>
            <div>
              <small>Effect lease</small>
              <strong>Browser #019</strong>
            </div>
            <div>
              <small>Budget</small>
              <strong>68% remaining</strong>
            </div>
          </section>

          <div className="a-dashboard-grid">
            <section className="panel dag-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">RUN DAG · REVISION 04</span>
                  <h2>Execution path</h2>
                </div>
                <button className="text-button">
                  Inspect DAG <ArrowRight size={14} />
                </button>
              </div>
              <div className="dag-track">
                {stages.map((stage, index) => (
                  <div className={`dag-node ${stage.state}`} key={stage.label}>
                    <div className="node-index">
                      {stage.state === "done" ? (
                        <Check size={13} />
                      ) : stage.state === "active" ? (
                        <CircleDot size={14} />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    <div>
                      <small>{stage.runtime}</small>
                      <strong>{stage.label}</strong>
                    </div>
                    <time>{stage.time}</time>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel runtime-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">SIBLING RUNTIMES</span>
                  <h2>Runtime activity</h2>
                </div>
                <span className="pulse-label">
                  <i /> LIVE
                </span>
              </div>
              <div className="runtime-cards">
                <article>
                  <span className="runtime-icon coding">
                    <Code2 size={17} />
                  </span>
                  <div>
                    <small>PI CODING RUNTIME</small>
                    <strong>Patch complete</strong>
                    <p>Button.module.css · +1 −1</p>
                  </div>
                  <CheckCircle2 size={18} className="success-icon" />
                </article>
                <article className="active">
                  <span className="runtime-icon browser">
                    <Camera size={17} />
                  </span>
                  <div>
                    <small>UI-TARS BROWSER RUNTIME</small>
                    <strong>Verifying geometry</strong>
                    <p>2 / 3 predicates confirmed</p>
                  </div>
                  <span className="mini-spinner" />
                </article>
              </div>
              <div className="authority-row">
                <ShieldCheck size={16} />
                <div>
                  <strong>Authority boundary intact</strong>
                  <span>0 denied effects · fence token current</span>
                </div>
              </div>
            </section>

            <section className="panel evidence-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">LATEST ARTIFACT</span>
                  <h2>Rendered verification</h2>
                </div>
                <StatusPill tone="green">2 / 3 PASS</StatusPill>
              </div>
              <ArtifactPreview />
              <div className="assertion-list">
                <div>
                  <Check size={14} /> Radius increased from 4 px to 24 px
                </div>
                <div>
                  <Check size={14} /> Button height and position unchanged
                </div>
                <div className="pending">
                  <span className="mini-spinner" /> Localized screenshot hash
                </div>
              </div>
            </section>

            <section className="panel event-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">APPEND-ONLY JOURNAL</span>
                  <h2>Recent events</h2>
                </div>
                <button className="text-button">View all</button>
              </div>
              <div className="event-list">
                {events.map((event) => (
                  <div key={event.time}>
                    <time>{event.time}</time>
                    <span className={`event-dot ${event.source}`} />
                    <p>
                      <strong>{event.title}</strong>
                      <small>{event.detail}</small>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>

      <aside className="a-runrail">
        <div className="runrail-heading">
          <div>
            <span className="eyebrow">WORKSPACE</span>
            <h2>prism/fixtures</h2>
          </div>
          <button className="icon-button" title="Search runs">
            <Search size={16} />
          </button>
        </div>
        <button
          className="run-filter"
          onClick={() =>
            setRunFilter(runFilter === "All runs" ? "Active only" : "All runs")
          }
        >
          <ListFilter size={14} /> {runFilter} <ChevronDown size={14} />
        </button>
        <div className="run-list">
          {runs
            .filter((run) => runFilter === "All runs" || run.status === "Verifying")
            .map((run, index) => (
              <button className={index === 0 ? "active" : ""} key={run.id}>
                <span
                  className={`run-status ${run.status.toLowerCase()}`}
                />
                <p>
                  <small>{run.id}</small>
                  <strong>{run.title}</strong>
                  <span>{run.status} · {index + 2}m ago</span>
                </p>
              </button>
            ))}
        </div>
        <button className="new-run" onClick={() => notify("New run draft opened")}>
          <Zap size={15} /> New repair run
        </button>
      </aside>
    </main>
  );
}

function VariantB({
  paused,
  setPaused,
  notify,
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const [centerTab, setCenterTab] = useState("Activity");
  const [evidenceTab, setEvidenceTab] = useState("Evidence");
  const [selectedArtifact, setSelectedArtifact] = useState("after.png");

  return (
    <main className="variant-b">
      <header className="b-menubar">
        <PrismMark compact />
        <div className="b-breadcrumbs">
          <span>fixtures</span>
          <ChevronRight size={13} />
          <span>react-repair</span>
          <ChevronRight size={13} />
          <strong>PR-2048</strong>
        </div>
        <div className="b-menu-actions">
          <span className="connection">
            <i /> LOCAL
          </span>
          <button
            onClick={() => {
              setPaused(!paused);
              notify(paused ? "Runtime resumed" : "Runtime paused");
            }}
            title={paused ? "Resume runtime" : "Pause runtime"}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button title="Workspace settings">
            <Settings2 size={15} />
          </button>
        </div>
      </header>

      <div className="b-workspace">
        <aside className="b-tree">
          <div className="pane-title">
            <span>RUN EXPLORER</span>
            <MoreHorizontal size={15} />
          </div>
          <div className="tree-section open">
            <button>
              <ChevronDown size={13} /> <strong>PR-2048</strong>
            </button>
            <div className="tree-items">
              <button>
                <GitBranch size={14} /> run-dag.json
              </button>
              <button>
                <FileCode2 size={14} /> repair-spec.json
              </button>
              <button>
                <ShieldCheck size={14} /> authority.json
              </button>
            </div>
          </div>
          <div className="tree-section open">
            <button>
              <ChevronDown size={13} /> <strong>ARTIFACTS</strong>
            </button>
            <div className="tree-items">
              {[
                ["baseline.png", "camera"],
                ["change.diff", "code"],
                ["tests.log", "test"],
                ["after.png", "camera"],
                ["report.json", "file"],
              ].map(([name, kind]) => (
                <button
                  className={selectedArtifact === name ? "selected" : ""}
                  onClick={() => setSelectedArtifact(name)}
                  key={name}
                >
                  {kind === "camera" ? (
                    <Camera size={14} />
                  ) : kind === "code" ? (
                    <Code2 size={14} />
                  ) : kind === "test" ? (
                    <TestTube2 size={14} />
                  ) : (
                    <Braces size={14} />
                  )}
                  {name}
                  {name === "after.png" && <i />}
                </button>
              ))}
            </div>
          </div>
          <div className="b-budget">
            <span>BUDGET</span>
            <div>
              <i />
            </div>
            <p>
              <strong>32%</strong> used · 31s
            </p>
          </div>
        </aside>

        <section className="b-center">
          <div className="b-run-header">
            <div>
              <span className="mono-kicker">RUN / PR-2048</span>
              <h1>Round the Save button</h1>
            </div>
            <StatusPill tone={paused ? "amber" : "blue"}>
              {paused ? "PAUSED" : "VERIFYING"}
            </StatusPill>
          </div>

          <div className="b-dag-ribbon">
            {stages.map((stage, index) => (
              <div className={stage.state} key={stage.label}>
                <span>
                  {stage.state === "done" ? (
                    <Check size={11} />
                  ) : (
                    index + 1
                  )}
                </span>
                <p>
                  <small>{stage.runtime}</small>
                  <strong>{stage.label}</strong>
                </p>
              </div>
            ))}
          </div>

          <div className="b-terminal">
            <div className="terminal-tabs">
              {["Activity", "Diff", "Tests"].map((tab) => (
                <button
                  key={tab}
                  className={centerTab === tab ? "active" : ""}
                  onClick={() => setCenterTab(tab)}
                >
                  {tab}
                  {tab === "Tests" && <span>14</span>}
                </button>
              ))}
            </div>
            {centerTab === "Activity" && (
              <div className="terminal-stream">
                <div className="terminal-entry orchestrator">
                  <aside>
                    <Command size={14} /> ORCH
                  </aside>
                  <article>
                    <time>09:42:01.042</time>
                    <strong>effect_lease.granted</strong>
                    <p>workspace.patch · fence=018 · expires_in=30s</p>
                  </article>
                </div>
                <div className="terminal-entry coding">
                  <aside>
                    <Code2 size={14} /> PI
                  </aside>
                  <article>
                    <time>09:42:10.155</time>
                    <strong>workspace.patch.completed</strong>
                    <pre>
                      <span>- border-radius: 4px;</span>
                      {"\n"}
                      <b>+ border-radius: 999px;</b>
                    </pre>
                  </article>
                </div>
                <div className="terminal-entry coding">
                  <aside>
                    <TestTube2 size={14} /> PI
                  </aside>
                  <article>
                    <time>09:42:15.614</time>
                    <strong>workspace.test.passed</strong>
                    <p>14 tests · 4.6s · exit 0</p>
                  </article>
                </div>
                <div className="terminal-entry browser live">
                  <aside>
                    <Camera size={14} /> TARS
                  </aside>
                  <article>
                    <time>09:42:18.307</time>
                    <strong>browser.verify.running</strong>
                    <p>predicate[2/3] button.position === baseline.position</p>
                    <span className="typing-caret" />
                  </article>
                </div>
              </div>
            )}
            {centerTab === "Diff" && (
              <div className="code-view">
                <p>
                  <span>1</span> .primaryButton {"{"}
                </p>
                <p className="removed">
                  <span>2</span> - border-radius: 4px;
                </p>
                <p className="added">
                  <span>2</span> + border-radius: 999px;
                </p>
                <p>
                  <span>3</span> {"}"}
                </p>
              </div>
            )}
            {centerTab === "Tests" && (
              <div className="test-view">
                <CheckCircle2 size={28} />
                <strong>14 tests passed</strong>
                <p>button.spec.ts · geometry.spec.ts · route.spec.ts</p>
                <small>Completed in 4.6s</small>
              </div>
            )}
          </div>

          <PromptComposer dark onRun={() => notify("Follow-up added to run")} />
        </section>

        <aside className="b-evidence">
          <div className="pane-title">
            <div>
              {["Evidence", "Oracle"].map((tab) => (
                <button
                  key={tab}
                  className={evidenceTab === tab ? "active" : ""}
                  onClick={() => setEvidenceTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <PanelLeft size={15} />
          </div>
          <div className="evidence-filebar">
            <Camera size={14} />
            <strong>{selectedArtifact}</strong>
            <span>1280 × 720</span>
          </div>
          {selectedArtifact.endsWith(".png") ? (
            <ArtifactPreview />
          ) : (
            <div className="artifact-document">
              <Braces size={28} />
              <strong>{selectedArtifact}</strong>
              <p>Artifact preview is represented as structured run evidence.</p>
            </div>
          )}
          <div className="b-inspector">
            <div className="inspector-heading">
              <span>VERIFICATION REPORT</span>
              <StatusPill tone="green">PASSING</StatusPill>
            </div>
            <dl>
              <div>
                <dt>Radius delta</dt>
                <dd>+20 px <Check size={13} /></dd>
              </div>
              <div>
                <dt>Bounding box</dt>
                <dd>unchanged <Check size={13} /></dd>
              </div>
              <div>
                <dt>Screenshot hash</dt>
                <dd className="pending">pending <Timer size={13} /></dd>
              </div>
            </dl>
            <div className="oracle-note">
              <ShieldCheck size={16} />
              <p>
                <strong>Deterministic oracle</strong>
                Qualitative model judgment is supplemental.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="b-statusbar">
        <span>
          <GitBranch size={13} /> fix/rounded-save
        </span>
        <span>
          <Circle size={8} fill="currentColor" /> effect lease: browser #019
        </span>
        <span>
          <ShieldCheck size={13} /> authority intact
        </span>
        <span className="right">run DAG rev.04 · journal seq.142</span>
      </footer>
    </main>
  );
}

function VariantC({
  paused,
  setPaused,
  notify,
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <main className="variant-c">
      <header className="c-header">
        <PrismMark />
        <nav>
          <button className="active">RUN DOSSIER</button>
          <button>EVALUATION LEDGER</button>
          <button>ARTIFACT ARCHIVE</button>
        </nav>
        <button className="c-icon-button" title="Open settings">
          <Settings2 size={17} />
        </button>
      </header>

      <div className="c-ticker">
        <span>RUN 2048</span>
        <span>•</span>
        <strong>VERIFICATION IN PROGRESS</strong>
        <span>•</span>
        <span>27 JUL 2026 / 09:42</span>
        <span className="ticker-rule" />
        <span>JOURNAL SEQ. 142</span>
      </div>

      <section className="c-hero">
        <div className="c-issue-number">
          <span>CASE</span>
          <strong>2048</strong>
        </div>
        <div className="c-title">
          <span className="eyebrow">FRONTEND REPAIR / DIRECTIONAL STYLE</span>
          <h1>Make the Save button clearly rounded.</h1>
          <p>
            A single-line repair moving through the complete Prism seam:
            baseline, scoped patch, tests, and rendered proof.
          </p>
        </div>
        <div className="c-verdict">
          <span>CURRENT VERDICT</span>
          <strong>{paused ? "ON HOLD" : "02 / 03"}</strong>
          <p>{paused ? "Run paused by operator" : "predicates confirmed"}</p>
          <button
            onClick={() => {
              setPaused(!paused);
              notify(paused ? "Dossier run resumed" : "Dossier run paused");
            }}
          >
            {paused ? <Play size={14} /> : <OctagonPause size={14} />}
            {paused ? "Resume run" : "Hold run"}
          </button>
        </div>
      </section>

      <div className="c-layout">
        <section className="c-main-column">
          <article className="c-section c-journey">
            <div className="c-section-heading">
              <span>01</span>
              <div>
                <small>THE RUN</small>
                <h2>One repair, seven controlled acts.</h2>
              </div>
              <p>
                The Orchestrator alone advances the graph. Coding and Browser
                runtimes meet only through typed outcomes and artifacts.
              </p>
            </div>
            <div className="c-timeline">
              {stages.map((stage, index) => (
                <div className={stage.state} key={stage.label}>
                  <span className="timeline-index">
                    {stage.state === "done" ? <Check size={13} /> : `0${index + 1}`}
                  </span>
                  <i />
                  <p>
                    <small>{stage.runtime}</small>
                    <strong>{stage.label}</strong>
                    <span>{stage.time}</span>
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="c-section c-proof">
            <div className="c-section-heading">
              <span>02</span>
              <div>
                <small>THE PROOF</small>
                <h2>Rendered evidence, not a model’s hunch.</h2>
              </div>
              <StatusPill tone="green">ORACLE ACTIVE</StatusPill>
            </div>
            <div className="proof-grid">
              <div className="proof-visual">
                <div className="proof-labels">
                  <span>ARTIFACT 07</span>
                  <span>AFTER / LOCALIZED</span>
                </div>
                <ArtifactPreview paper />
                <p className="caption">
                  <b>Fig. 02</b> Browser observation at 1280 × 720. Blue marks
                  indicate measured geometry used by the deterministic predicate.
                </p>
              </div>
              <div className="proof-findings">
                <span>FINDINGS</span>
                <div className="finding pass">
                  <strong>+20</strong>
                  <p>
                    <b>Radius delta / px</b>
                    Increase exceeds the minimum directional threshold.
                  </p>
                  <Check size={15} />
                </div>
                <div className="finding pass">
                  <strong>0</strong>
                  <p>
                    <b>Layout shift / px</b>
                    Bounding box and button position remain invariant.
                  </p>
                  <Check size={15} />
                </div>
                <div className="finding waiting">
                  <strong>…</strong>
                  <p>
                    <b>Artifact integrity</b>
                    Awaiting final localized screenshot hash.
                  </p>
                  <Clock3 size={15} />
                </div>
              </div>
            </div>
          </article>
        </section>

        <aside className="c-notes-column">
          <article className="field-note blue">
            <span>FIELD NOTE / 01</span>
            <Bot size={22} />
            <h3>Two runtimes.<br />One authority.</h3>
            <p>
              Pi may patch source. UI-TARS may observe and propose browser
              actions. Neither can rewrite the run plan.
            </p>
          </article>

          <article className="c-ledger">
            <div className="ledger-heading">
              <span>RUN LEDGER</span>
              <Activity size={16} />
            </div>
            <dl>
              <div>
                <dt>Elapsed</dt>
                <dd>31.4 s</dd>
              </div>
              <div>
                <dt>Model tokens</dt>
                <dd>18,420</dd>
              </div>
              <div>
                <dt>Graph revision</dt>
                <dd>04</dd>
              </div>
              <div>
                <dt>Denied effects</dt>
                <dd>00</dd>
              </div>
            </dl>
          </article>

          <article className="field-note ink">
            <span>PATCH / 1 LINE</span>
            <Code2 size={20} />
            <pre>
              <s>border-radius: 4px;</s>
              {"\n"}
              <b>border-radius: 999px;</b>
            </pre>
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide provenance" : "Show provenance"}
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {expanded && (
              <p className="provenance">
                Button.module.css · WorkspaceExecutor · effect fence #018
              </p>
            )}
          </article>

          <article className="c-journal">
            <div className="ledger-heading">
              <span>LATEST JOURNAL ENTRIES</span>
              <History size={16} />
            </div>
            {events.slice(0, 3).map((event) => (
              <div key={event.time}>
                <time>{event.time}</time>
                <p>
                  <strong>{event.title}</strong>
                  {event.detail}
                </p>
              </div>
            ))}
            <button onClick={() => notify("Journal drawer opened")}>
              Read all 142 events <ArrowRight size={14} />
            </button>
          </article>
        </aside>
      </div>

      <footer className="c-footer">
        <p>
          <PrismMark compact />
          <span>RUN MANIFEST / IMMUTABLE</span>
        </p>
        <p>HASH 8F6A—70DE—B122</p>
        <button onClick={() => notify("Replay prepared from journal")}>
          <RotateCcw size={14} /> Prepare replay
        </button>
      </footer>
    </main>
  );
}

function VariantD({ notify }: { notify: (message: string) => void }) {
  const [prompt, setPrompt] = useState(
    "Make the primary Save button clearly rounded instead of square",
  );
  const [queued, setQueued] = useState(false);
  const [selectedCase, setSelectedCase] = useState("PR-2048");
  const recentCases = [
    { id: "PR-2048", title: "Round the Save button", state: "Verifying", meta: "31s · 7 artifacts" },
    { id: "PR-2047", title: "Restore card shadow", state: "Passed", meta: "1m 12s · 9 artifacts" },
    { id: "PR-2046", title: "Repair profile dialog", state: "Passed", meta: "2m 04s · 12 artifacts" },
  ];

  return (
    <main className="variant-d">
      <header className="d-header">
        <PrismMark />
        <nav>
          <button className="active">FIELD DESK</button>
          <button>RUNS</button><button>EVALUATIONS</button><button>ARTIFACTS</button>
        </nav>
        <div className="d-header-tools">
          <span><i /> LOCAL</span>
          <button title="Open settings"><Settings2 size={17} /></button>
        </div>
      </header>

      <section className="d-entry">
        <div className="d-entry-copy">
          <span className="d-kicker">NEW REPAIR / LOCAL WORKSPACE</span>
          <h1>What should Prism repair?</h1>
          <p>Describe the visible problem. Prism will inspect the repository, reproduce it in the browser, and return with rendered proof.</p>
        </div>
        <div className="d-composer">
          <div className="d-workspace-row">
            <span><FolderGit2 size={14} /> prism / fixtures / react-repair</span>
            <button>Change workspace</button>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => { setPrompt(event.target.value); setQueued(false); }}
            aria-label="Describe the frontend repair"
          />
          <div className="d-composer-actions">
            <div>
              <button><Camera size={15} /> Attach evidence</button>
              <button><Gauge size={15} /> 1280 × 720</button>
            </div>
            <button
              className={queued ? "queued" : "primary"}
              onClick={() => { setQueued(true); notify("Repair request queued in the local workspace"); }}
            >
              {queued ? <Check size={15} /> : <Sparkles size={15} />}
              {queued ? "Repair queued" : "Start repair"}
            </button>
          </div>
        </div>
        <aside className="d-entry-guide">
          <div className="d-guide-heading"><span>HOW PRISM ENTERS</span><Waypoints size={18} /></div>
          <ol>
            <li><span>01</span><p><strong>Understand</strong>Normalize the request into verifiable predicates.</p></li>
            <li><span>02</span><p><strong>Reproduce</strong>Capture a browser baseline before source mutation.</p></li>
            <li><span>03</span><p><strong>Repair & prove</strong>Patch through Pi, then verify through UI-TARS.</p></li>
          </ol>
          <div className="d-safety-note"><ShieldCheck size={16} /><p><strong>Safe by default</strong>Local fixture · scoped access · deterministic oracle</p></div>
        </aside>
      </section>

      <section className="d-fieldwork">
        <div className="d-section-title">
          <span>ACTIVE FIELDWORK</span><h2>Continue where you left off.</h2>
          <p>The entry stays visible above; detailed evidence unfolds only when a run exists.</p>
        </div>
        <div className="d-field-grid">
          <article className="d-active-case">
            <div className="d-case-heading">
              <div>
                <span>CASE {selectedCase.replace("PR-", "")}</span>
                <small>FRONTEND REPAIR / DIRECTIONAL STYLE</small>
                <h3>{recentCases.find((item) => item.id === selectedCase)?.title}</h3>
              </div>
              <div className="d-case-verdict"><small>CURRENT VERDICT</small><strong>{selectedCase === "PR-2048" ? "02 / 03" : "PASSED"}</strong></div>
            </div>
            <div className="d-run-path">
              {stages.map((stage, index) => (
                <div className={stage.state} key={stage.label}>
                  <span>{stage.state === "done" ? <Check size={11} /> : `0${index + 1}`}</span><i />
                  <p><small>{stage.runtime}</small><strong>{stage.label}</strong></p>
                </div>
              ))}
            </div>
            <div className="d-proof-row">
              <ArtifactPreview paper />
              <div className="d-findings">
                <div><span>+20</span><p><strong>Radius delta / px</strong>Directional threshold passed.</p><Check size={15} /></div>
                <div><span>0</span><p><strong>Layout shift / px</strong>Position remains invariant.</p><Check size={15} /></div>
                <button onClick={() => notify(`Opened dossier for ${selectedCase}`)}>Open full run dossier <ArrowRight size={14} /></button>
              </div>
            </div>
          </article>
          <aside className="d-case-rail">
            <div className="d-rail-heading"><span>RECENT CASES</span><button><Search size={15} /></button></div>
            {recentCases.map((item) => (
              <button
                className={selectedCase === item.id ? "active" : ""}
                key={item.id}
                onClick={() => { setSelectedCase(item.id); notify(`Selected ${item.id}`); }}
              >
                <span className={`d-case-dot ${item.state.toLowerCase()}`} />
                <p><small>{item.id}</small><strong>{item.title}</strong><span>{item.state} · {item.meta}</span></p>
                <ChevronRight size={14} />
              </button>
            ))}
            <div className="d-rail-summary"><span>THIS WEEK</span><strong>15 / 18</strong><p>successful fixture attempts</p></div>
          </aside>
        </div>
      </section>
      <footer className="d-footer"><PrismMark compact /><p>VISUAL SWE HARNESS / DUAL RUNTIME / VERIFIED</p><span>LOCAL WORKSPACE · NO EXTERNAL EFFECTS</span></footer>
    </main>
  );
}

export function PrismPrototype() {
  const [toast, setToast] = useState("");
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };
  return (
    <>
      <VariantD notify={notify} />
      {toast && (
        <div className="prototype-toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
    </>
  );
}
