/**
 * Field Desk 客户端 UI 状态
 *
 * 用 zustand 维护页面级的轻量 UI 状态：目前只有 Run 列表的
 * 状态筛选（全部 / 某个 RunStatus）。
 */
import type { RunStatus } from "@prism/contracts";
import { create } from "zustand";

/** Run 列表的状态筛选值："all" 或某个具体运行状态。 */
export type RunStatusFilter = "all" | RunStatus;

/** Field Desk 页面状态。 */
interface FieldDeskState {
  runStatusFilter: RunStatusFilter;
  setRunStatusFilter: (filter: RunStatusFilter) => void;
}

export const useFieldDeskStore = create<FieldDeskState>()((set) => ({
  runStatusFilter: "all",
  setRunStatusFilter: (runStatusFilter) => set({ runStatusFilter }),
}));
