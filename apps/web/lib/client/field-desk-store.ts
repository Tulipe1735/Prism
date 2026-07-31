import type { RunStatus } from "@prism/contracts";
import { create } from "zustand";

export type RunStatusFilter = "all" | RunStatus;

interface FieldDeskState {
  runStatusFilter: RunStatusFilter;
  setRunStatusFilter: (filter: RunStatusFilter) => void;
}

export const useFieldDeskStore = create<FieldDeskState>()((set) => ({
  runStatusFilter: "all",
  setRunStatusFilter: (runStatusFilter) => set({ runStatusFilter }),
}));
