// Shared GitHub Gist constants, reused by every plugin that syncs through a
// private gist (manga-source-updates, local-catalog-manager, …).

// Client ID of the "Seanime Extensions Sync" GitHub OAuth App (Device Flow
// enabled, `gist` scope). PUBLIC by design — device flow uses no client secret,
// so this is safe to commit. One app, shared across plugins.
export const GITHUB_CLIENT_ID = "Ov23li6KslJmP3EaLxXj";
