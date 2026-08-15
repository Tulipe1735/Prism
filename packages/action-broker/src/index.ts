/**
 * Prism 动作代理（action-broker）包
 *
 * 负责把"浏览器动作提议"转化为可审计的浏览器动作记录：
 *  - 在动作执行前观测页面（before），作为新鲜度基准；
 *  - 对坐标类目标做新鲜度（freshness）策略校验：若提议所基于的观测
 *    与当前页面状态不一致，则拒绝执行并标记 stale；
 *  - 通过 BrowserPort 执行点击，再观测执行后状态（after），
 *    把提议、策略裁决、执行结果、前后观测封装为不可变的 BrowserActionRecord。
 *
 * 浏览器能力本身由 ./browser-executor 中的 BrowserExecutor 提供（基线采集）。
 */
import {
  BROWSER_ACTION_RECORD_SCHEMA_VERSION,
  type BrowserActionProposal,
  browserActionProposalSchema,
  type BrowserActionRecord,
  browserActionRecordSchema,
  type BrowserKey,
  type BrowserObservationReference,
  type BrowserTarget,
} from "@prism/contracts";

export {
  type BrowserBaselineCapture,
  BrowserExecutor,
  type BrowserExecutorOptions,
} from "./browser-executor";

/** 浏览器端口：动作代理执行浏览器操作所需的两个原语。 */
export interface BrowserPort {
  /** 观测当前页面状态，返回一次观测引用。 */
  observe: () => Promise<BrowserObservationReference>;
  /** 在页面上点击给定目标。 */
  click: (target: BrowserTarget) => Promise<void>;
  /** 发送一枚允许的键盘按键。 */
  press: (key: BrowserKey) => Promise<void>;
}

/** 动作代理构造选项。 */
export interface ActionBrokerOptions {
  /** 浏览器端口实现（生产为 Playwright，测试可注入 mock）。 */
  port: BrowserPort;
  /** 时钟注入，便于测试固定时间。 */
  clock?: () => Date;
}

/**
 * 判断坐标目标的"新鲜度"：提议基于的观测是否与当前观测完全一致。
 *
 * 仅对 kind === "coordinate" 的目标检查；语义/混合目标不受此限。
 * 比较观察 ID、截图哈希、页面状态哈希与视口三要素 —— 任一项不一致
 * 都说明页面已变化，坐标不再可靠，应判定为 stale。
 */
function coordinateTargetIsFresh(
  proposal: BrowserActionProposal,
  observation: BrowserObservationReference,
): boolean {
  if (!("target" in proposal) || proposal.target.kind !== "coordinate") {
    return true;
  }

  const target = proposal.target;
  return (
    target.observationId === observation.observationId &&
    target.screenshotHash === observation.screenshotHash &&
    target.pageStateHash === observation.pageStateHash &&
    target.viewport.width === observation.viewport.width &&
    target.viewport.height === observation.viewport.height &&
    target.viewport.deviceScaleFactor === observation.viewport.deviceScaleFactor
  );
}

/**
 * 动作代理：把浏览器动作提议转换为经过策略裁决的可审计动作记录。
 */
export class ActionBroker {
  private readonly clock: () => Date;

  constructor(private readonly options: ActionBrokerOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * 执行一次提议的浏览器动作，返回完整的动作记录。
   *
   * 流程：校验提议 → 观测 before → 新鲜度策略校验：
   *  - stale：坐标目标已不新鲜，拒绝执行（不发送任何浏览器输入）；
   *  - allowed：执行点击，再观测 after 写入成功记录；
   *  - 执行抛错：记录 allowed 但 execution=failed（策略已放行，执行失败）。
   *
   * @param input 必须通过 browserActionProposalSchema 校验的提议
   * @returns 记录，含提议、策略裁决、执行结果与前后观测
   */
  async execute(input: unknown): Promise<BrowserActionRecord> {
    const proposal = browserActionProposalSchema.parse(input);
    const before = await this.options.port.observe();

    // 坐标目标必须与当前观测一致，否则判定 stale 并拒绝
    if (!coordinateTargetIsFresh(proposal, before)) {
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "stale",
          reason: "The coordinate target no longer matches its grounded observation.",
        },
        execution: {
          status: "stale",
          message: "Prism did not send browser input for a stale coordinate target.",
        },
        before,
        after: null,
        recordedAt: this.clock().toISOString(),
      });
    }

    try {
      if ("target" in proposal) {
        await this.options.port.click(proposal.target);
      } else {
        await this.options.port.press(proposal.action.key);
      }
      const after = await this.options.port.observe();
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "allowed",
          reason: "The typed proposal passed the broker freshness policy.",
        },
        execution: { status: "executed", message: "Browser input completed." },
        before,
        after,
        recordedAt: this.clock().toISOString(),
      });
    } catch (error) {
      // 策略已放行，但执行失败：如实记录失败信息
      const message = error instanceof Error ? error.message : "Browser input failed.";
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "allowed",
          reason: "The typed proposal passed the broker freshness policy.",
        },
        execution: { status: "failed", message },
        before,
        after: null,
        recordedAt: this.clock().toISOString(),
      });
    }
  }
}
