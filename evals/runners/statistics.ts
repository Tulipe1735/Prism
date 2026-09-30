import type { SummaryRecord } from "../schema.ts";

export const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function wilson(successes: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.959963984540054;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [
    successes === 0 ? 0 : Math.max(0, center - half),
    successes === n ? 1 : Math.min(1, center + half),
  ];
}
export function taskRates(runs: SummaryRecord[]): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const run of runs)
    grouped.set(run.task_id, [
      ...(grouped.get(run.task_id) ?? []),
      Number(run.success),
    ]);
  return new Map([...grouped].sort().map(([id, values]) => [id, mean(values)]));
}
/** Resample tasks, preserving each task's repeats; deterministic seed for reproducibility. */
export function clusterInterval(values: number[]): [number, number] {
  if (!values.length) return [0, 0];
  let seed = 1735;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const samples = Array.from({ length: 2000 }, () =>
    mean(
      Array.from(
        { length: values.length },
        () => values[Math.floor(random() * values.length)]!,
      ),
    ),
  ).sort((a, b) => a - b);
  return [samples[49]!, samples[1949]!];
}
export function variability(runs: SummaryRecord[]): Array<{
  task: string;
  variant: string;
  runs: number;
  successMixed: boolean;
  behaviorMixed: boolean;
}> {
  const groups = new Map<string, SummaryRecord[]>();
  for (const r of runs) {
    const key = `${r.task_id}/${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].sort().map(([, group]) => ({
    task: group[0]!.task_id,
    variant: group[0]!.variant,
    runs: group.length,
    successMixed: new Set(group.map((r) => r.success)).size > 1,
    behaviorMixed:
      new Set(
        group.map((r) =>
          JSON.stringify([
            r.success,
            r.failure_type,
            r.steps,
            r.llm_calls,
            r.wrong_target_actions,
            r.invalid_outputs,
            r.stale_events,
          ]),
        ),
      ).size > 1,
  }));
}

export function health(
  runs: SummaryRecord[],
  expected: number,
): { healthy: boolean; reasons: string[]; variance: ReturnType<typeof variability> } {
  const reasons = [];
  if (runs.length !== expected)
    reasons.push(`Incomplete cohort: ${runs.length}/${expected}.`);
  if (
    new Set(runs.map((r) => `${r.task_id}/${r.variant}/${r.repetition}`)).size !==
    runs.length
  )
    reasons.push("Duplicate planned pair.");
  if (
    runs.some(
      (r) =>
        ["OBSERVATION_ERROR", "UNKNOWN"].includes(r.failure_type ?? "") ||
        /HTTP|connection failed|Fixture did not|oracle/i.test(r.reason),
    )
  )
    reasons.push("Infrastructure or oracle errors require inspection.");
  if (new Set(runs.map((r) => r.metadata.source_hash)).size > 1)
    reasons.push("Source changed within cohort.");
  if (runs.some((r) => r.metadata.returned_models.some((m) => m !== r.metadata.model)))
    reasons.push("Returned model differs from configured model.");
  return { healthy: reasons.length === 0, reasons, variance: variability(runs) };
}
