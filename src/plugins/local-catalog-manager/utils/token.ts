// Effective GitHub token resolver, shared by every runtime (register + hooks).
// Device-flow OAuth token ($storage, set by the tray's "Connect GitHub") wins;
// falls back to the `githubToken` PAT config field. Pure reads of runtime
// globals — the build inlines this into each isolated callback wrapper.
import { K_OAUTH_TOKEN } from "./constants";

export const oauthToken = (): string =>
  ($storage.get<string>(K_OAUTH_TOKEN) ?? "").trim();

export const patToken = (): string =>
  ($getUserPreference("githubToken") ?? "").trim();

export const syncToken = (): string => oauthToken() || patToken();
