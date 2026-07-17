export interface MUResult {
  id: string;
  title: string;
  year?: number;
  cover?: string;
  url: string;
}

export interface MULink extends MUResult {
  linkedAt: number;
}

export interface MuPendingUpdate {
  status?: $app.AL_MediaListStatus;
  progress?: number;
  scoreRaw?: number;
}
