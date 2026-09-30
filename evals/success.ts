import type { BrowserSession } from "../src/browser/session.ts";
import type { Evidence, SuccessCondition } from "./schema.ts";
import { evidenceSchema } from "./schema.ts";

/** Read-only oracle. No task-provided JavaScript is evaluated. Missing elements fail. */
export async function readEvidence(
  session: BrowserSession,
  condition: SuccessCondition,
): Promise<Evidence> {
  const expression = `(() => {
    const condition = ${JSON.stringify(condition)};
    const checks = condition.checks.map(check => {
      let actual = null;
      if (check.kind === 'url') actual = location.href;
      else {
        const element = document.querySelector(check.selector);
        if (element) {
          if (check.kind === 'text') actual = element.textContent.trim();
          if (check.kind === 'value' && 'value' in element) actual = String(element.value);
          if (check.kind === 'attribute') actual = element.getAttribute(check.attribute);
        }
      }
      return {expected: check.equals, actual, passed: actual === check.equals};
    });
    function counter(selector, attribute) {
      const value = document.querySelector(selector)?.getAttribute(attribute);
      return value != null && /^\\d+$/.test(value) ? Number(value) : null;
    }
    const audit = condition.wrongTargetCounter;
    return {checks,
      wrong_targets: audit ? counter(audit.selector, audit.attribute) : null,
      mutation_count: counter('#eval-state', 'data-mutations')};
  })()`;
  const response = await session.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error("Success oracle could not read the page.");
  return evidenceSchema.parse(response.result?.value);
}

export function evaluateSuccess(
  evidence: Evidence,
  condition: SuccessCondition,
): boolean {
  return (
    evidence.checks.length === condition.checks.length &&
    evidence.checks.every(
      (check, index) =>
        check.passed &&
        check.expected === condition.checks[index]?.equals &&
        check.actual === condition.checks[index]?.equals,
    ) &&
    (condition.wrongTargetCounter === undefined || evidence.wrong_targets === 0)
  );
}
