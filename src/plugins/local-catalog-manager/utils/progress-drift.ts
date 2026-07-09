import { numericFieldDiff, stringFieldDiff } from "./field-diff";

export type SeanimeListData = {
  status?: $app.AL_MediaListStatus;
  progress?: number;
  score?: number;
};

export const hasEntryProgressDrift = (
  rowProgress: MangaProgressEntry | undefined,
  seanimeData: SeanimeListData | undefined,
  lookupReady: boolean,
): boolean => {
  if (!rowProgress) return false;
  return (
    !lookupReady ||
    !seanimeData ||
    stringFieldDiff(rowProgress.status, seanimeData.status) ||
    numericFieldDiff(rowProgress.progress, seanimeData.progress) ||
    numericFieldDiff(rowProgress.score, seanimeData.score)
  );
};
