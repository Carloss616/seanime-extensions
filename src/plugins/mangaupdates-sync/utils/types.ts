// Normalized MangaUpdates series — consumed by the UI and link store.
// Produced by MUClient.search from raw MUSearch.Response records.

export interface MUResult {
  id: string;
  title: string;
  year?: number;
  cover?: string;
  url: string;
}

// A persisted link extends MUResult with when it was linked.
export interface MULink extends MUResult {
  linkedAt: number;
}

export interface MuPendingUpdate {
  status?: $app.AL_MediaListStatus;
  progress?: number;
  scoreRaw?: number;
}
