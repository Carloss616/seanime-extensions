export type ClientCacheScope = {
  catalog?: boolean;
  progress?: boolean;
};

export const clientCacheQueryKeys = (opts: ClientCacheScope): string[] => {
  const keys: string[] = [];
  if (opts.catalog) {
    keys.push("CUSTOM-SOURCE-custom-source-list-manga");
  }
  if (opts.progress) {
    keys.push(
      "MANGA-get-manga-collection",
      "MANGA-get-anilist-manga-collection",
      "MANGA-get-manga-entry",
    );
  }
  return keys;
};
