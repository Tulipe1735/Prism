export interface RecentRun {
  id: string;
  status: string;
  title: string;
}

export interface RunDossier {
  id: string;
  title: string;
}

export async function listRecentRuns(): Promise<readonly RecentRun[]> {
  return [];
}

export async function getRunDossier(runId: string): Promise<RunDossier | null> {
  void runId;
  return null;
}
