"""Post-cohort interpretation only. No model calls or changes to frozen/raw files.

Regenerate the frozen statistical report, then add data-derived prose, protocol-error
subtypes and explicit structural-collision counts. Statistical estimands/intervals
are exactly those in the preregistration and frozen report implementation.
"""
import collections
import hashlib
import json
from pathlib import Path
import subprocess

subprocess.run([
    'node', '--experimental-strip-types', '--disable-warning=ExperimentalWarning',
    'evals/runners/confirmatory-report.ts',
], check=True)
root = Path('evals/reports')
report = root / 'paper-confirmatory-v1.md'
analysis_path = root / 'paper-confirmatory-v1-analysis.json'
analysis = json.loads(analysis_path.read_text())
assert analysis['audit']['complete'] and analysis['audit']['valid']
raw_path = Path('evals/results/paper-confirmatory-v1.jsonl')
raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
records = [json.loads(line) for line in raw_path.read_text().splitlines() if line]
runs = [r for r in records if r['record_type'] == 'summary']
steps = [r for r in records if r['record_type'] == 'step']
by_run = {r['run_id']: r for r in runs}
effects = analysis['effects']

def effect(key, scale=1):
    e = effects[key]
    if e is None:
        return 'n/a'
    return f"{e['difference']*scale:.2f} [{e['interval'][0]*scale:.2f}, {e['interval'][1]*scale:.2f}]"

def arm(variant):
    return [r for r in runs if r['variant'] == variant]

def average(variant, field):
    rs = arm(variant)
    assert all(r[field] is not None for r in rs)
    return sum(r[field] for r in rs) / len(rs)

adaptive = arm('indexed-adaptive')
structural = arm('indexed-structural')
local = arm('indexed-local')
initial_cost = {}
for variant in ['indexed-local', 'indexed-structural', 'indexed-adaptive']:
    first = [next(s for s in steps if s['run_id'] == r['run_id'] and s['representation_cost']) for r in arm(variant)]
    initial_cost[variant] = sum(s['representation_cost']['estimated_tokens'] for s in first) / len(first)
context_savings = 100 * (1-initial_cost['indexed-adaptive']/initial_cost['indexed-structural'])
local_cost_savings = 100 * (1-average('indexed-adaptive', 'total_tokens')/average('indexed-local', 'total_tokens'))
structural_cost_savings = 100 * (1-average('indexed-adaptive', 'total_tokens')/average('indexed-structural', 'total_tokens'))

output_diagnostics = []
for step in steps:
    if not step['error']:
        continue
    if step['raw_model_output'] is None:
        subtype = 'MISSING_MODEL_CONTENT'
    else:
        try:
            output = json.loads(step['raw_model_output'])
        except (ValueError, TypeError):
            output = None
        if not isinstance(output, dict):
            subtype = 'INVALID_JSON_OBJECT'
        elif not isinstance(output.get('operation'), dict):
            subtype = 'OPERATION_HEAD_SHAPE'
        else:
            op = output['operation']
            probs = op.get('probabilities')
            if not isinstance(probs, dict):
                subtype = 'OPERATION_HEAD_SHAPE'
            elif set(probs) != set(step['model_input']['operations']):
                subtype = 'OPERATION_HEAD_KEYS'
            elif isinstance(output.get('target'), dict) and 'confidence' not in output['target']:
                subtype = 'TARGET_HEAD_MISSING_CONFIDENCE'
            else:
                subtype = 'OTHER_VALIDATION_FAILURE'
    output_diagnostics.append({
        'run_id': step['run_id'], 'task_id': step['task_id'], 'variant': step['variant'],
        'repetition': step['repetition'], 'step': step['step'],
        'recorded_failure_type': step['failure_type'], 'error': step['error'],
        'output_diagnostic': subtype, 'output_tokens': step['output_tokens'],
        'grounding_success': by_run[step['run_id']]['grounding_success'],
    })
counts = collections.Counter(d['output_diagnostic'] for d in output_diagnostics)
missing = [s for s in steps if s['error'] and s['raw_model_output'] is None]
reasoning_budget_cases = [s for s in missing if s['output_tokens'] == 8192 and any(u.get('completion_tokens_details', {}).get('reasoning_tokens') == 8192 for u in s['usage'])]
strict_only = [r for r in runs if r['grounding_success'] and not r['strict_task_success']]
primary_failures = collections.Counter(r['failure_type'] for r in runs if not r['strict_task_success'])

for observation in analysis['adaptive_observations']:
    observation['structural_collisions'] = len(observation['collision_groups']['structural'])
all_confusion = {expected: {actual: 0 for actual in ['compact', 'role', 'local', 'structural']} for expected in ['compact', 'role', 'local', 'structural']}
for o in analysis['adaptive_observations']:
    all_confusion[o['expected_minimum_level']][o['final_level']] += 1
analysis['all_observation_confusion'] = all_confusion
analysis['post_cohort_interpretation'] = {
    'initial_representation_savings_percent_vs_structural': context_savings,
    'provider_total_tokens_point_savings_percent_vs_local': local_cost_savings,
    'provider_total_tokens_point_savings_percent_vs_structural': structural_cost_savings,
    'primary_failure_counts': dict(primary_failures),
    'output_diagnostic_counts': dict(counts),
    'strict_only_failure_count': len(strict_only),
    'missing_content_at_full_reasoning_budget': len(reasoning_budget_cases),
    'raw_result_sha256': raw_hash,
    'analysis_source': str(Path(__file__).resolve()),
    'analysis_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
}
analysis_path.write_text(json.dumps(analysis, indent=2)+'\n')
(root/'paper-confirmatory-v1-failure-diagnostics.json').write_text(json.dumps(output_diagnostics, indent=2)+'\n')

text = report.read_text()
rq1 = (
    f"Structural context helped where headings/legends were required: structural-class grounding was 18/20 "
    f"with Structural and 18/20 with Adaptive, versus 5/20 with Local. Structural minus Local was "
    f"{effect('structural/structural-minus-local/grounding',100)} percentage points (95% task-cluster CI); "
    f"Adaptive minus Local was {effect('structural/indexed-local/grounding',100)} pp. On local-class tasks, "
    f"Local already achieved 18/20 grounding and no wrong inputs; richer context did not show a consistent "
    f"advantage. Unique-class rate differences included response-format failures rather than observed wrong "
    f"inputs. Overall Adaptive minus Local grounding was {effect('overall/indexed-local/grounding',100)} pp. "
    f"The evidence supports matching semantic scope to the ambiguity class, within these fixtures, rather "
    f"than universal improvement from richer descriptions.\n\n"
)
text = text.replace('## RQ1 — Action Representation and Grounding\n\n', '## RQ1 — Action Representation and Grounding\n\n'+rq1, 1)
rq2 = (
    f"Adaptive's initial representation averaged {initial_cost['indexed-adaptive']:.2f} estimated tokens, "
    f"versus {initial_cost['indexed-structural']:.2f} for Structural: {context_savings:.1f}% less. "
    f"Adaptive grounded 56/60 runs versus Structural's 53/60, with zero observed wrong inputs versus "
    f"Structural's seven wrong inputs in one trajectory after a correct first click. The reliability-gap "
    f"interval permits Adaptive to be up to 5 pp worse under this empirical analysis; the study does not "
    f"establish non-inferiority. The five over-expansions were all local-04's preregistered unrelated Help "
    f"collision; no initial under-expansion was observed.\n\n"
)
text = text.replace('## RQ2 — Adaptive Context Expansion\n\n', '## RQ2 — Adaptive Context Expansion\n\n'+rq2, 1)
rq3 = (
    f"Usage was reported for all 496 actual calls; there were zero HTTP/stale retries or infrastructure "
    f"failures. Adaptive used {average('indexed-adaptive','total_tokens'):.2f} provider tokens/task, "
    f"versus Local's {average('indexed-local','total_tokens'):.2f} ({local_cost_savings:.1f}% lower; paired "
    f"difference {effect('overall/indexed-local/total_tokens')} tokens). Structural averaged "
    f"{average('indexed-structural','total_tokens'):.2f}; Adaptive's {structural_cost_savings:.1f}% lower "
    f"point estimate had paired CI {effect('overall/indexed-structural/total_tokens')}, which crosses zero. "
    f"Thus end-to-end token savings are supported versus Local, and remain unestablished versus Structural. "
    f"Adaptive actually exposes more initial context than Local on structural tasks, while using fewer "
    f"calls and fewer output tokens there. This directly shows why per-observation size alone is an "
    f"inadequate efficiency measure.\n\n"
)
assert sum(r['llm_calls'] for r in runs) == 496
text = text.replace('## RQ3 — End-to-End Context Efficiency\n\n', '## RQ3 — End-to-End Context Efficiency\n\n'+rq3, 1)
text = text.replace('Tokens here are ceil', 'The aggregate cost table weights observations equally; matched tokens/observation effects first average inside each run, then compare matched repeats and task clusters. Initial-observation cost is the common-candidate-set primary scope comparison.\n\nTokens here are ceil', 1)
failure_prose = (
    f"Primary strict failures were {primary_failures['MODEL_OUTPUT_ERROR']} MODEL_OUTPUT_ERROR and "
    f"{primary_failures['SEMANTIC_AMBIGUITY']} SEMANTIC_AMBIGUITY. {len(strict_only)} trajectories grounded "
    f"correctly but later failed strict success. Across failed decision attempts (including trajectories "
    f"whose primary label remains semantic), there were {counts['OPERATION_HEAD_KEYS']} operation-distribution "
    f"key mismatches, {counts['TARGET_HEAD_MISSING_CONFIDENCE']} missing target confidence fields, "
    f"{counts['OPERATION_HEAD_SHAPE']} wrong operation-head shapes and {counts['MISSING_MODEL_CONTENT']} "
    f"missing-content responses. All {len(reasoning_budget_cases)} missing-content responses were in Local "
    f"structural-class runs and reported 8,192 output tokens, all as reasoning tokens, with no action JSON. "
    f"This is concrete usage evidence of output-budget exhaustion, rather than a provider timeout. "
    f"Do not recode their recorded primary labels.\n\n"
    f"For example, Adaptive unique-01/r0 executed Save profile correctly, then returned DONE with a "
    f"probability distribution omitting the still-offered CLICK key. It is grounding true and strict false. "
    f"Structural local-02/r0 grounded Museum correctly, then made seven wrong inputs and reached the "
    f"eight-action budget: grounding true, strict false, semantic primary failure, and budget termination. "
    f"Local structural-02 grounded 5/5 despite insufficient semantic scope; the requested item occupied "
    f"the first position. Position-based selection can succeed without disambiguation, and the balanced "
    f"set/per-task analysis exposes this rather than treating final success as proof of sufficient context.\n\n"
)
text = text.replace('## Failure Analysis\n\n', '## Failure Analysis\n\n'+failure_prose, 1)
text = text.replace('## Threats to Validity\n\n', '## Threats to Validity\n\nThe unchanged extractor can attach the first heading inside its main scope to sibling controls (e.g. Save profile receives section Cancel; Atlas receives section Support East). These noisy fields are part of the frozen treatment, not evidence of correct ancestor semantics. No extractor fix or task replacement was made after outcomes. This further limits attributing an effect to one individual context field.\n\n', 1)
old_start = text.index('RQ1: compare the class-specific')
old_end = text.index('\n\nA second-model replication', old_start)
conclusions = (
    f"RQ1: Structural and Adaptive each grounded 90% of structural-class runs, versus Local's 25%; "
    f"Local remained sufficient for the local-class controls. RQ2: Adaptive reduced initial representation "
    f"cost by {context_savings:.1f}% relative to Structural, with grounding 93.3% versus 88.3%, a "
    f"Structural-minus-Adaptive gap of -5.00 pp [−15.00, 5.00], zero observed wrong inputs, "
    f"91.7% minimum-level matches, five over-expansions and zero under-expansions. This supports observed "
    f"context savings alongside high grounding; non-inferiority remains unestablished. RQ3: Adaptive "
    f"reduced complete provider tokens/task by {local_cost_savings:.1f}% relative to Local, with a negative "
    f"paired CI; its {structural_cost_savings:.1f}% lower point estimate versus Structural has an interval "
    f"crossing zero. Similar observed grounding/strict success does not establish equivalence."
)
text = text[:old_start]+conclusions+text[old_end:]
ledger_insert = (
    f"| Supported | Structural context improved grounding relative to Local on the frozen structural-class tasks (+65.00 pp [10.00, 100.00]); this is stratum-specific evidence. |\n"
    f"| Supported | Adaptive improved grounding relative to Local across this balanced cohort (+26.67 pp [6.67, 50.00]). |\n"
    f"| Supported | Adaptive reduced complete provider tokens/task relative to Local ({effect('overall/indexed-local/total_tokens')} tokens; {local_cost_savings:.1f}% point saving). |\n"
)
text = text.replace('| Supported | Adaptive reduces initial', ledger_insert+'| Supported | Adaptive reduces initial', 1)
text += '\nPost-cohort interpretation and explicit structural-collision counts are reproducible with `python3 evals/analysis/paper-confirmatory-v1.py` under the pinned Node environment. This script regenerates the frozen analysis before adding interpretation; it makes no model calls and does not modify raw results or frozen controls.\n'
report.write_text(text)
assert hashlib.sha256(raw_path.read_bytes()).hexdigest() == raw_hash
print(json.dumps(analysis['post_cohort_interpretation'], indent=2))
