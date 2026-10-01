"""Post-cohort interpretation of the frozen cross-model analysis.

Makes no model calls. Reuses the frozen report/statistical functions, preserves all
original labels and qualitative criteria, and never writes parent-study artifacts.
"""
import collections
import hashlib
import json
from pathlib import Path
import subprocess

ID = 'paper-replication-model2-v1'
ROOT = Path('evals/reports')
raw_path = Path(f'evals/results/{ID}.jsonl')
raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
subprocess.run(['node', '--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'evals/replication/report.ts'], check=True)
analysis_path = ROOT / f'{ID}-analysis.json'
analysis = json.loads(analysis_path.read_text())
assert analysis['audit']['complete'] and analysis['audit']['valid']
records = [json.loads(line) for line in raw_path.read_text().splitlines()]
runs = [r for r in records if r['record_type'] == 'summary']
steps = [r for r in records if r['record_type'] == 'step']
responses = [json.loads(line) for line in Path(f'evals/results/{ID}-responses.jsonl').read_text().splitlines()]
parent_records = [json.loads(line) for line in Path('evals/results/paper-confirmatory-v1.jsonl').read_text().splitlines()]
parent_runs = [r for r in parent_records if r['record_type'] == 'summary']
parent_steps = [r for r in parent_records if r['record_type'] == 'step']
parent_analysis = json.loads((ROOT / 'paper-confirmatory-v1-analysis.json').read_text())
by_run = {r['run_id']: r for r in runs}
by_steps = {r['run_id']: [s for s in steps if s['run_id'] == r['run_id']] for r in runs}
annotations = {t['id']: t['preregistered'] for t in json.loads(Path('evals/tasks/paper-confirmatory-v1.json').read_text())}

def arm(variant, rs=runs):
    return [r for r in rs if r['variant'] == variant]

def average(variant, key, rs=runs):
    selected = arm(variant, rs)
    assert all(r[key] is not None for r in selected)
    return sum(r[key] for r in selected) / len(selected)

def effect(key, scale=1, source=analysis):
    e = source['effects'][key]
    if e is None:
        return 'n/a (incomplete usage)'
    return f"{e['difference'] * scale:.2f} [{e['interval'][0] * scale:.2f}, {e['interval'][1] * scale:.2f}]"

first = {r['run_id']: next(s for s in by_steps[r['run_id']] if s['representation_cost']) for r in runs}
parent_first = {r['run_id']: next(s for s in parent_steps if s['run_id'] == r['run_id'] and s['representation_cost']) for r in parent_runs}
cell = lambda r: (r['task_id'], r['variant'], r['repetition'])
parent_by_cell = {cell(r): r for r in parent_runs}
prompt_drift = []
for r in runs:
    p = parent_by_cell[cell(r)]
    if first[r['run_id']]['prompt_hash'] != parent_first[p['run_id']]['prompt_hash']:
        prompt_drift.append('/'.join(map(str, cell(r))))
assert len(runs) == 240 and len(set(map(cell, runs))) == 240
assert not prompt_drift, prompt_drift

# Extend response diagnostics to include valid BLOCKED terminal responses in failed
# trajectories. This does not relabel them as MODEL_OUTPUT_ERROR: primary DECISION_ERROR
# and accepted response status remain explicit. Both first-target outcome and any prior
# correct execution are retained, rather than conflating repair with Grounding Success.
diagnostics = analysis['response_diagnostics']
known = {(d['run_id'], d['step']) for d in diagnostics}
for r in runs:
    if r['strict_task_success']:
        continue
    last = by_steps[r['run_id']][-1]
    if (r['run_id'], last['step']) in known:
        continue
    try:
        parsed = json.loads(last['raw_model_output'] or 'null')
    except ValueError:
        parsed = None
    matches = [p for p in responses if p['run_id'] == r['run_id'] and p['prompt_hash'] == last['prompt_hash']]
    response = next((p for p in reversed(matches) if p.get('status') == 200), {})
    reasoning = response.get('usage', {}).get('completion_tokens_details', {}).get('reasoning_tokens')
    output = last['output_tokens']
    diagnostics.append({
        'run_id':r['run_id'], 'task_id':r['task_id'], 'variant':r['variant'], 'repetition':r['repetition'], 'step':last['step'],
        'failure_type':r['failure_type'], 'error':last['error'], 'terminal_reason':r['reason'],
        'response_validation_accepted':last['validation_valid'],
        'output_tokens':output, 'final_content_emitted':bool(last['raw_model_output']),
        'final_structured_content_emitted':isinstance(parsed, dict),
        'finish_reason':response.get('finish_reason'), 'reasoning_tokens':reasoning,
        'reasoning_consumed_entire_output_budget': None if reasoning is None or output is None else reasoning >= 8192 and output >= 8192,
        'full_output_budget': None if output is None else output >= 8192,
        'target_decision_recoverable':isinstance(parsed, dict) and isinstance(parsed.get('target'), dict) and isinstance(parsed['target'].get('choice'), str),
        'recovered_target':parsed['target'].get('choice') if isinstance(parsed, dict) and isinstance(parsed.get('target'), dict) else None,
        'partial_reasoning_available':bool(response.get('reasoning_content')), 'response_attempts':len(matches),
    })
for d in diagnostics:
    r = by_run[d['run_id']]
    row = next(s for s in by_steps[r['run_id']] if s['step'] == d['step'])
    prior = [s for s in by_steps[r['run_id']] if s['step'] < d['step']]
    d['grounding_success_first_target'] = r['grounding_success']
    d['any_prior_correct_target_execution'] = any(s['executed'] and s['target_assessment'] == 'correct' for s in prior)
    d['grounding_phase'] = 'after-correct-grounding' if d['any_prior_correct_target_execution'] else 'before-correct-grounding'
    d['primary_run_failure_type'] = r['failure_type']
    d['response_validation_accepted'] = row['validation_valid']
    if d['recovered_target'] is not None:
        d['partial_output_target_assessment'] = 'Explicit target choice recoverable; validation failure is retained and no action is repaired/executed.'
    elif d['full_output_budget']:
        if d['task_id'] == 'paper-structural-03':
            d['partial_output_target_assessment'] = 'Reasoning contains a provisional CLICK/target 2 plan and later considers competing layouts. No final JSON; no unique validated final decision recoverable.'
            d['provisional_target_in_reasoning'] = '2 (provisional, not a final or validated decision)'
        else:
            d['partial_output_target_assessment'] = 'Unfinished reasoning revisits earlier wrong-team actions and completion hypotheses; no unique validated final decision recoverable.'
        d['target_recoverable_from_partial_reasoning'] = False
    elif r['failure_type'] == 'DECISION_ERROR':
        d['partial_output_target_assessment'] = 'Final BLOCKED operation is recoverable; no target is required on this terminal turn. The prior correct target execution is separately recorded.'
        d['target_recoverable_from_partial_reasoning'] = 'Not applicable: valid final BLOCKED content exists.'

reasoning_cases = [d for d in diagnostics if d['reasoning_consumed_entire_output_budget'] and not d['final_content_emitted']]
assert len(reasoning_cases) == 2
assert all(d['variant'] == 'indexed-local' and annotations[d['task_id']]['ambiguity_class'] == 'structural' for d in reasoning_cases)
strict_only = [r for r in runs if r['grounding_success'] and not r['strict_task_success']]
assert len(strict_only) == 8 and all(r['failure_type'] == 'DECISION_ERROR' for r in strict_only)

savings = 100 * (1-average('indexed-adaptive', 'total_tokens')/average('indexed-local', 'total_tokens'))
parent_strict_effect = effect('overall/indexed-structural/strict',100,parent_analysis)
strict_effect = effect('overall/indexed-structural/strict',100)
report_path = ROOT / f'{ID}.md'
report = report_path.read_text()

# Replace machine-readable manifest excerpts by compact human-readable prose. The
# complete frozen manifest remains the source of truth; no manifest edit occurs.
start = report.index('Model configuration: ')
end = report.index('## 2. Control-Diff Audit', start)
report = report[:start] + '''| Model setting | Frozen value / observed limitation |
|---|---|
| Model / provider | deepseek-v4.1-flash / OpenCode Go, same chat-completions endpoint as parent |
| Temperature / top_p requested | 0 / 1; no setting emulated |
| Output budget | 8,192 tokens on every call, including failures |
| Reasoning | Provider default; no thinking or reasoning_effort overrides. Smoke and cohort responses emitted reasoning tokens. |
| Effective sampling | DeepSeek documents temperature as ineffective in thinking mode; OpenCode effective sampling/default effort is not exposed. Fixed requested settings do not establish deterministic serving. |
| Structured output | Same json_object mode, prompt and probability-head validator; JSON syntax does not guarantee Prism schema or usable final content. |
| Connectivity / allowance | One neutral smoke before benchmark; 240 benchmark cells completed without HTTP or quota errors. No model switch, extra usage or purchase enabled. |

Settings and capability sources: [OpenCode Go](https://opencode.ai/docs/go/) and
[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).

''' + report[end:]
start = report.index('{"expected_difference"')
end = report.index('Passive response record coverage:', start)
report = report[:start] + '''Expected treatment difference: model/provider-model configuration only. Cohort ID,
artifact paths and dedicated browser profile differ to isolate the study. All other
cohort settings, method sources, task annotations, fixture bytes, prompts, browser
revision, JavaScript engine, Node and OS metadata match. Separate orchestration and
passive response logging add no policy feedback; minor host/latency overhead is disclosed.

Qualitative criteria were frozen before outcomes: a positive structural scope effect
without consistent local-task need for Structural; high Adaptive grounding, no substantial
wrong-target increase and smaller representation context; lower Adaptive total usage
versus Local with favorable or unresolved usage versus Structural. These are qualitative
criteria, not newly invented significance thresholds or a non-inferiority margin.

''' + report[end:]
report = report.replace('## 3. RQ1 — Action Representation and Grounding\n\n',
    '## 3. RQ1 — Action Representation and Grounding\n\n'
    'RQ1 replicated. Structural-class grounding was 20/20 with Structural, 19/20 with Adaptive, '
    'and 5/20 with Local. Structural minus Local was '+effect('structural/structural-minus-local/grounding',100)+' pp; all four structural tasks had a positive paired effect. '
    'Every local task achieved 5/5 grounding with both Local and Structural: richer context was not consistently needed. '
    'Unique tasks also reached 20/20 with Local and Structural. These findings support matching scope to ambiguity, '
    'not universally requiring structural context; chance successes under insufficient context remain possible.\n\n')
report = report.replace('## 4. RQ2 — Adaptive Context Expansion\n\n',
    '## 4. RQ2 — Adaptive Context Expansion\n\n'
    'RQ2 qualitatively replicated on grounding and context exposure: Adaptive grounded 58/60 (96.7%) versus '
    'Structural 60/60 (100%), with no wrong executed inputs, 35.4% less initial representation context, '
    '55/60 minimum matches, five over-expansions and no under-expansions. The observed 3.33 pp grounding '
    'deficit has a 95% task-cluster interval of 0 to 8.33 pp; these are descriptively close rates, not '
    'established reliability preservation. The two Adaptive grounding failures were malformed responses before execution. '
    'Initial expansion counts match the parent exactly, as expected for the deterministic unchanged policy and fixed fixtures.\n\n'
    'Strict completion did not preserve the same pattern: Adaptive 52/60 versus Structural 60/60, '
    'Adaptive minus Structural '+strict_effect+' pp. Six Adaptive trajectories selected the correct target '
    'but subsequently reported BLOCKED. Grounding, termination and strict success therefore require separate claims.\n\n')
report = report.replace('## 5. RQ3 — End-to-End Context Efficiency\n\n',
    '## 5. RQ3 — End-to-End Context Efficiency\n\n'
    f'RQ3 replicated the original pattern. Adaptive used 1,748.03 versus Local 4,177.88 tokens/task, {savings:.1f}% less, '
    'with paired difference '+effect('overall/indexed-local/total_tokens')+'. Adaptive versus Structural was '
    '1,748.03 versus 1,772.30, paired difference '+effect('overall/indexed-structural/total_tokens')+'. '
    'The latter interval crosses zero, so total savings over Structural remain unresolved despite smaller initial context. '
    'All 520 HTTP calls reported usage; these totals include failed trajectories and reasoning tokens.\n\n'
    'Adaptive saved input tokens relative to Structural ('+effect('overall/indexed-structural/input_tokens')+') '
    'but used more output tokens on average ('+effect('overall/indexed-structural/output_tokens')+'). '
    'The structural stratum even had a positive point difference in total usage ('+effect('structural/indexed-structural/total_tokens')+'), '
    'with unresolved interval. The overall Adaptive/Local saving is concentrated in structural-ambiguity tasks; '
    'local-class cost is unresolved. Tokens per grounding success were 1,808.31 for Adaptive versus 1,772.30 for Structural; '
    'tokens per strict success were 2,016.96 versus 1,772.30. Lower per-task usage does not establish equal success-adjusted efficiency.\n\n')
report = report.replace('## 6. Failure Analysis\n\n',
    '## 6. Failure Analysis\n\n'
    'Failure distribution changed materially: MODEL_OUTPUT_ERROR fell from 33/240 (13.75%) to 3/240 (1.25%); '
    'DECISION_ERROR rose from 0 to 8/240 (3.33%). SEMANTIC_AMBIGUITY was 15 versus 14; both models had exactly '
    '14 Local/structural-class primary semantic failures. Those recurring insufficient-scope failures are more '
    'representation-stable than formatting or completion behavior. Local wrong executed inputs rose from 35 to 47 '
    'because some trajectories repeatedly selected wrong controls. Adaptive observed zero wrong inputs in both models.\n\n'
    'All eight DeepSeek DECISION_ERROR failures grounded correctly and then emitted valid BLOCKED JSON. Six were '
    'Adaptive and two selector-reference; three Adaptive cases were local-04. Preserved reasoning reinterpreted '
    'the disabled/completed requested control as missing or uneditable, sometimes treating the visible completion '
    'status as a suspected trap despite the preceding correct click. This is observed termination reasoning, '
    'not evidence that the action was grounded incorrectly. The repeated local-04 over-expansion is shared '
    'across models, but its co-occurrence with three DeepSeek BLOCKED decisions does not establish causation.\n\n'
    'The two Adaptive MODEL_OUTPUT_ERROR cases emitted recoverable target choices but violated the probability-head '
    'schema: unique-04/r2 omitted other offered target keys, and structural-02/r2 used a scalar operation. '
    'The Local structural-03/r4 response emitted no usable content. No schema repairs or extra calls were made.\n\n'
    'Reasoning exhaustion is not exclusive to GLM: it occurred in two DeepSeek Local/structural-class responses, '
    'each with all 8,192 output tokens recorded as reasoning and finish_reason=length. One was structural-03/r4 '
    'before any input; one was structural-01/r2 after wrong-team inputs. The latter retains primary '
    'SEMANTIC_AMBIGUITY and an independent output-exhaustion diagnostic. Both had no final JSON and no '
    'uniquely validated final target recoverable from the partial reasoning; structural-03 contained provisional '
    'target-2 speculation, not an executed or validated decision. The parent had four such responses. '
    'Absence of final JSON appears as missing content under GLM and empty content under DeepSeek, so comparisons '
    'treat null and empty content alike without changing primary labels.\n\n')
report = report.replace('## Effect directions and magnitudes', '### Effect directions and magnitudes')
report = report.replace('## Failure distribution', '### Failure distribution')
start = report.index('## 8. Replication Status')
end = report.index('## 9. Threats to Validity', start)
report = report[:start] + '''## 8. Replication Status

| Question | Qualitative replication assessment |
|---|---|
| RQ1 | Replicated: all four structural tasks favor Structural over Local; all local tasks ground perfectly with Local. |
| RQ2 | Qualitatively replicated for high grounding, zero observed wrong inputs and lower representation context; reliability preservation remains inconclusive. Strict completion is model-sensitive and worse for Adaptive under DeepSeek. |
| RQ3 | Replicated pattern: total saving versus Local is supported, while saving versus Structural remains unresolved. |

The most stable behavioral effect is the structural scope advantage (GLM +65 pp,
DeepSeek +75 pp), together with Local sufficiency on local ambiguity. Static representation
savings are identically 35.4%, a reproducibility consequence of fixed inputs/policy rather
than independent evidence for new tasks. The most model-sensitive effects are protocol/
termination behavior and Adaptive's relative grounding direction: +5 pp under GLM versus
−3.33 pp under DeepSeek. Adaptive minus Structural strict success changes from '''+parent_strict_effect+''' pp
under GLM to '''+strict_effect+''' pp under DeepSeek.

This evidence is sufficient to proceed to separately preregistered external/open-web
validation of the scope and cost hypotheses. It does not establish deployment reliability
or external validity. That next study should audit grounding and termination separately,
retain total usage and output-budget diagnostics, and avoid treating authored fixture
success as proof that real-web interactions have succeeded. No external experiments
were started during this milestone.

Future method revision: investigate completion-evidence interpretation, structured-head
errors and whole-space over-expansion; none was changed during this cohort. Any method
revision requires a new version and a separate evaluation, not repair of these results.

'''+report[end:]
report = report.replace('Additional cross-model limitation:',
    'Some preserved reasoning speculates about synthetic benchmark layout from fixture URLs; '
    'this is observable heuristic reasoning, not evidence of training exposure. The shared goal/URL/prompt '
    'limits independence and external validity. No URLs or task wording were changed.\n\nAdditional cross-model limitation:')
# Keep broad preservation unproven. Add narrower observable claims explicitly.
needle='| Inconclusive | Adaptive preserves descriptively Structural-like grounding reliability.'
assert needle in report
report = report.replace('Statistical non-inferiority/equivalence, universally required structural context',
    '| Replicated | Adaptive executed zero wrong targets in both completed cohorts. | GLM 0 and DeepSeek 0; cohort-only observation, not a universal zero-error claim. |\n'
    '| Partially replicated | Adaptive has high descriptive grounding with less representation context. | 93.3% vs 88.3% under GLM; 96.7% vs 100% under DeepSeek. No non-inferiority margin; relative direction reverses. |\n\n'
    'Statistical non-inferiority/equivalence, universally required structural context')
report += '\nPost-cohort interpretation is reproducible with `python3 evals/analysis/paper-replication-model2-v1.py` under the pinned Node environment. It uses the frozen statistical implementation and does not rerun trials or write parent artifacts. The final verification artifact records all checks and the matched initial-prompt audit. Raw JSONL and source archives are retained locally under `evals/results/`, which follows the repository ignore policy.\n'
report = report.replace('\n\n| Replicated | Adaptive executed zero wrong targets', '\n| Replicated | Adaptive executed zero wrong targets')
report_path.write_text(report)

cross_path = ROOT / 'cross-model-summary.md'
cross = cross_path.read_text()
row='| Adaptive zero/low wrong-target inputs | 0 | 0 | Replicated (observed zero only) |'
cross = cross.replace(row,row+'\n| Adaptive versus Structural grounding | 93.3% vs 88.3% | 96.7% vs 100% | Descriptively close; formal preservation inconclusive |\n| Adaptive versus Structural strict success | 88.3% vs 83.3% | 86.7% vs 100% | Model-sensitive reversal |')
cross = cross.replace('Replicated; assess per-task evidence','Replicated; all four local tasks 5/5 under both Local and Structural')
cross += f'''\n## Interpretation and next milestone

RQ1 replicated; RQ2 qualitatively replicated on grounding/context exposure, while
reliability preservation is inconclusive and strict completion is worse for Adaptive
under DeepSeek. RQ3 replicated the pattern: Adaptive used {savings:.1f}% fewer total tokens
than Local with a negative task-cluster CI, while Adaptive versus Structural remained
unresolved. No raw runs were pooled.

MODEL_OUTPUT_ERROR fell 33→3, and all eight new DECISION_ERROR cases grounded correctly
before valid BLOCKED responses. The shared Local/structural-class semantic count was
14 in each cohort. Reasoning exhaustion occurred under both models (4→2), confined to
Local/structural ambiguity here; its frequency and final-content convention differ.

Cross-model evidence now supports the structural scope advantage, local sufficiency
on these local tasks, lower Adaptive initial representation exposure, observed zero
Adaptive wrong targets, and lower Adaptive total usage versus Local. Statistical
non-inferiority, general preservation of strict success, total savings versus Structural,
universal necessity and open-web validity remain unsupported. The evidence justifies
external/open-web validation as the next study, without assuming external success.

The unchanged static policy explains identical initial cost/minimum-match/expansion
counts; those are not independent evidence on a new task distribution. The relative
grounding direction and termination behavior are model-sensitive. All 240 initial
message hashes match the parent's matched cells; runtime/source hashes match and all
202 protected files remain unchanged. Required final checks are recorded separately.
'''
cross_path.write_text(cross)
analysis['response_diagnostics'] = diagnostics
analysis['post_cohort_interpretation'] = {
    'analysis_source': str(Path(__file__).resolve()),
    'analysis_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'initial_prompt_pairs_checked': 240, 'initial_prompt_drift': prompt_drift,
    'adaptive_vs_local_total_tokens_savings_percent': savings,
    'strict_only_failures':len(strict_only),
    'full_reasoning_budget_responses':len(reasoning_cases),
    'failed_response_and_terminal_diagnostic_count':len(diagnostics),
    'rq1_qualitative_status':'Replicated',
    'rq2_qualitative_status':'Qualitatively replicated on grounding/context; reliability preservation inconclusive; strict completion model-sensitive',
    'rq3_qualitative_status':'Replicated pattern: versus Local supported, versus Structural unresolved',
    'claim_scope':'Same twelve authored fixtures; no pooled model estimates or formal non-inferiority.',
}
analysis_path.write_text(json.dumps(analysis,indent=2)+'\n')
(ROOT / f'{ID}-failure-diagnostics.json').write_text(json.dumps(diagnostics,indent=2)+'\n')
assert hashlib.sha256(raw_path.read_bytes()).hexdigest() == raw_hash
print(json.dumps(analysis['post_cohort_interpretation'],indent=2))
