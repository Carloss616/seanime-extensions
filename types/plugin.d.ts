// Minimal subset of seanime's plugin runtime types — only what the
// extensions in this repo actually touch. The full surface lives in
// internal/extension_repo/goja_plugin_types/ in the seanime source tree;
// if you need more bindings, copy them in (they are type-only, the runtime
// already exposes everything).

declare function init(): void;

declare namespace $app {
  type AL_MediaListStatus =
    | "CURRENT"
    | "PLANNING"
    | "COMPLETED"
    | "DROPPED"
    | "PAUSED"
    | "REPEATING";

  interface AL_BaseManga_Title {
    english?: string;
    native?: string;
    romaji?: string;
    userPreferred?: string;
  }

  interface AL_BaseManga {
    id: number;
    idMal?: number;
    title?: AL_BaseManga_Title;
    synonyms?: string[];
    /** For AniList entries: https://anilist.co/manga/<id>.
     *  For custom-source entries seanime wraps the original URL as
     *  `ext_custom_source_<extId>|END|<original-url>` (see
     *  internal/customsource/customsource.go:formatSiteUrl in seanime). */
    siteUrl?: string;
  }

  interface AL_MediaListEntry_Media {
    id?: number;
    idMal?: number;
    title?: AL_BaseManga_Title;
  }

  interface AL_MediaList {
    id?: number;
    mediaId?: number;
    status?: AL_MediaListStatus;
    progress?: number;
    score?: number;
    media?: AL_MediaListEntry_Media;
  }

  interface AL_MediaListGroup {
    status?: AL_MediaListStatus;
    entries?: AL_MediaList[];
  }

  interface AL_MangaCollection {
    MediaListCollection?: {
      lists?: AL_MediaListGroup[];
    };
  }

  /** Triggered before AniList updates an entry's progress.
   *  Call event.preventDefault() to skip the default AniList update. */
  interface PreUpdateEntryProgressEvent {
    next(): void;
    preventDefault(): void;
    mediaId?: number;
    progress?: number;
    totalCount?: number;
    status?: AL_MediaListStatus;
  }

  function onPreUpdateEntryProgress(
    cb: (event: PreUpdateEntryProgressEvent) => void,
  ): void;

  /** Triggered after AniList successfully updates an entry's progress. */
  interface PostUpdateEntryProgressEvent {
    next(): void;
    mediaId?: number;
  }

  function onPostUpdateEntryProgress(
    cb: (event: PostUpdateEntryProgressEvent) => void,
  ): void;

  /** Triggered before AniList updates an entry via the full edit flow
   *  (status / score / progress / dates). Call event.preventDefault() to
   *  skip the default AniList update. */
  interface PreUpdateEntryEvent {
    next(): void;
    preventDefault(): void;
    mediaId?: number;
    status?: AL_MediaListStatus;
    scoreRaw?: number;
    progress?: number;
  }

  function onPreUpdateEntry(cb: (event: PreUpdateEntryEvent) => void): void;

  /** Triggered after AniList successfully commits a full entry edit. */
  interface PostUpdateEntryEvent {
    next(): void;
    mediaId?: number;
  }

  function onPostUpdateEntry(cb: (event: PostUpdateEntryEvent) => void): void;
}

declare namespace $anilist {
  /** Returns the user's manga collection, optionally bypassing the cache. */
  function getMangaCollection(bypassCache: boolean): $app.AL_MangaCollection;

  /** Lookup a single manga by AniList id. */
  function getManga(id: number): $app.AL_BaseManga;
}

declare namespace $storage {
  function set(key: string, value: any): void;
  function get<T = any>(key: string): T | undefined;
  function has(key: string): boolean;
  function remove(key: string): void;
  function keys(): string[];
}

/** Cross-runtime in-memory store. Persists for the plugin's lifetime and is
 *  shared between the loader VM (where init() runs) and the pool runtimes
 *  that execute hook callbacks. Use it to hand state between Pre and Post
 *  hooks (callbacks cannot close over module scope). */
declare namespace $store {
  function set<T = any>(key: string, value: T): void;
  function get<T = any>(key: string): T | undefined;
  function has(key: string): boolean;
  function remove(key: string): void;
  function removeAll(): void;
}

/** Plugin UI surface.
 *
 *  Only the bits this plugin uses are typed here. All declarations mirror the
 *  public documentation at https://seanime.gitbook.io/seanime-extensions —
 *  no fork-only or undocumented APIs.
 *
 *  Reference pages this file is derived from:
 *    /plugins/ui/basics                  ($ui.register, ctx.state, ctx.effect, ctx.fetch)
 *    /plugins/ui/user-interface/action   (ctx.action.newMangaPageButton)
 *    /plugins/ui/user-interface/tray     (ctx.newTray, tray.* components)
 *    /plugins/ui/user-interface/screen   (ctx.screen.onNavigate, loadCurrent)
 *    /plugins/example                    (banner-images example — patterns)
 */
declare namespace $ui {
  function register(callback: (ctx: PluginContext) => void): void;
}

interface DOMElement {
  /** Some elements have an id assigned by `identifyChildren: true`. */
  readonly id?: string;
  readonly innerHTML?: string;

  queryOne(selector: string): Promise<DOMElement | null>;
  getParent(): Promise<DOMElement | null>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): Promise<string | null>;
  /** Reads a `data-*` attribute (returns the string after `data-`). */
  getDataAttribute(name: string): Promise<string | null>;
  setStyle(property: string, value: string): void;
  addClass(className: string): void;
  setText(text: string): void;
  /** Sets a JS-side property like `className` (array form supported). */
  setProperty(name: string, value: unknown): void;
  /** Replaces the element's innerHTML with the given markup. */
  setInnerHTML(html: string): void;
  append(child: DOMElement): void;
  before(sibling: DOMElement): void;
  after(sibling: DOMElement): void;
  remove(): void;
  addEventListener(event: string, callback: (e: any) => void): () => void;
}

interface DOMManager {
  onReady(callback: () => void): void;
  onMainTabReady(callback: () => void): void;
  query(selector: string, opts?: Record<string, any>): Promise<DOMElement[]>;
  queryOne(
    selector: string,
    opts?: Record<string, any>,
  ): Promise<DOMElement | null>;
  observe(
    selector: string,
    callback: (elements: DOMElement[]) => void | Promise<void>,
    opts?: Record<string, any>,
  ): [stop: () => void, refetch: () => void];
  createElement(tagName: string): Promise<DOMElement>;
  /** Looks up an element by id assigned via `identifyChildren: true`. */
  asElement(id: string): DOMElement;
}

/** Goquery-style snapshot parser. The returned `$` is callable with a CSS
 *  selector and exposes `.attr(name)` on the match (more methods exist in
 *  the runtime but aren't currently used here). */
declare const LoadDoc: (html: string) => (selector: string) => {
  attr(name: string): string | undefined;
};

/** Subset of `ctx.manga`. We only consume `getCollection()` for the
 *  link-time stats sync — full surface is much larger. */
interface MangaListEntry {
  media: $app.AL_BaseManga;
  listData?: {
    progress?: number;
    status?: $app.AL_MediaListStatus;
    score?: number;
    scoreRaw?: number;
  };
}

interface MangaCollection {
  lists?: Array<{
    status?: $app.AL_MediaListStatus;
    entries?: MangaListEntry[];
  }>;
}

interface MangaManager {
  getCollection(): Promise<MangaCollection>;
}

interface PluginContext {
  action: ActionManager;
  screen: ScreenManager;
  toast: ToastManager;
  dom: DOMManager;
  manga: MangaManager;

  /** Reactive state. Re-runs effects and tray.render when set() is called. */
  state<T>(initial: T): State<T>;
  /** Runs the callback when any state in deps changes. */
  effect(callback: () => void, deps: State<any>[]): void;
  /** Synchronous handle to a form field's value. */
  fieldRef<T = string>(initial?: T): FieldRef<T>;
  /** Register a global named handler. The string id is referenced from
   *  tray.button({ onClick: "the-id" }) etc. */
  registerEventHandler(
    id: string,
    callback: (event?: any) => void | Promise<void>,
  ): void;
  /** Inline event handler with a unique id per element. Returned value is
   *  passed as the onClick of a tray component. */
  eventHandler(
    uniqueId: string,
    callback: (event?: any) => void | Promise<void>,
  ): unknown;
  /** UI-context fetch. Required (instead of plain fetch) inside $ui.register;
   *  the network host must be in plugin.permissions.allow.networkAccess. */
  fetch(input: string, init?: FetchOptions): Promise<FetchResponse>;

  newTray(opts: NewTrayOptions): Tray;
  newWebview(opts: WebviewOptions): Webview;
}

type WebviewSlot =
  | "screen"
  | "fixed"
  | "after-home-screen-toolbar"
  | "home-screen-bottom"
  | "schedule-screen-top"
  | "schedule-screen-bottom"
  | "anime-screen-bottom"
  | "after-anime-entry-episode-list"
  | "after-anime-episode-list"
  | "before-anime-entry-episode-list"
  | "manga-screen-bottom"
  | "manga-entry-screen-bottom"
  | "after-manga-entry-chapter-list"
  | "after-discover-screen-header"
  | "after-media-entry-details"
  | "after-media-entry-form";

interface WebviewOptions {
  slot: WebviewSlot;
  className?: string;
  style?: string;
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
  zIndex?: number;
  autoHeight?: boolean;
  fullWidth?: boolean;
  hidden?: boolean;
  sidebar?: { label: string; icon: string };
  window?: {
    draggable?: boolean;
    defaultX?: number;
    defaultY?: number;
    defaultPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    frameless?: boolean;
  };
}

interface WebviewChannel {
  /** Auto-pushes the state value to the webview whenever it changes.
   *  Inside the iframe: `window.webview.on(name, cb)`. */
  sync<T>(name: string, state: State<T>): void;
  /** Listen to events sent from the iframe via `window.webview.send`. */
  on(name: string, callback: (payload: any) => void): void;
}

interface Webview {
  channel: WebviewChannel;
  setContent(builder: () => string): void;
  onMount(callback: () => void): void;
  onUnmount(callback: () => void): void;
  onLoad(callback: () => void): void;
  update(): void;
  getScreenPath(): string;
  hide(): void;
  show(): void;
}

interface State<T> {
  get(): T;
  set(value: T | ((prev: T) => T)): void;
}

interface FieldRef<T = string> {
  readonly current: T | undefined;
  setValue(value: T): void;
}

type Intent =
  | "primary"
  | "primary-subtle"
  | "alert"
  | "alert-subtle"
  | "warning"
  | "warning-subtle"
  | "success"
  | "success-subtle"
  | "white"
  | "white-subtle"
  | "gray"
  | "gray-subtle";

/** Common action methods documented under /plugins/ui/user-interface/action.
 *  Intentionally excludes `setLoading` / `setDisabled` / `setTooltipText`
 *  — those exist in the runtime but are NOT in the public doc. */
interface ActionObject<E = {}> {
  mount(): void;
  unmount(): void;
  setLabel(label: string): void;
  setStyle(style: Record<string, string>): void;
  setIntent(intent: Intent): void;
  onClick(handler: (event: E) => void): void;
}

type MangaPageButtonAction = ActionObject<{ media: $app.AL_BaseManga }>;

interface ActionManager {
  newMangaPageButton(props: {
    label: string;
    intent?: Intent;
    style?: Record<string, string>;
  }): MangaPageButtonAction;
}

interface ScreenNavigateEvent {
  pathname: string;
  searchParams: Record<string, string>;
}

interface ScreenManager {
  onNavigate(callback: (event: ScreenNavigateEvent) => void): void;
  /** Triggers `onNavigate` with the current screen — useful at plugin
   *  load time (the navigation event itself may have already fired). */
  loadCurrent(): void;
  navigateTo(path: string, searchParams?: Record<string, string>): void;
}

interface ToastManager {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  alert(message: string): void;
}

interface NewTrayOptions {
  tooltipText?: string;
  iconUrl?: string;
  /** Whether the tray opens a popover with arbitrary content (true) or just
   *  reacts to `onClick` (false). */
  withContent?: boolean;
  isDrawer?: boolean;
}

interface TrayBadgeUpdate {
  number: number;
  intent?: "alert" | "info" | "warning" | "success";
}

interface Tray {
  /** Component constructors. Each returns an opaque value rendered by
   *  the runtime. The exact return type is intentionally `unknown`. */
  text(text: string, opts?: Record<string, any>): unknown;
  span(text: string, opts?: Record<string, any>): unknown;
  stack(items: unknown[], opts?: Record<string, any>): unknown;
  flex(items: unknown[], opts?: Record<string, any>): unknown;
  div(items: unknown[], opts?: Record<string, any>): unknown;
  /** Anchor element. `tray.a` and `tray.anchor` are aliases (see Tray docs).
   *  `target: "_blank"` opens the URL externally (system browser on desktop). */
  anchor(
    items: unknown[],
    opts: {
      href: string;
      target?: string;
      rel?: string;
      className?: string;
      style?: Record<string, string>;
    },
  ): unknown;
  a(
    items: unknown[],
    opts: {
      href: string;
      target?: string;
      rel?: string;
      className?: string;
      style?: Record<string, string>;
    },
  ): unknown;
  img(opts: {
    src: string;
    alt?: string;
    className?: string;
    style?: Record<string, string>;
  }): unknown;
  input(label: string, opts: { fieldRef: FieldRef<string> }): unknown;
  button(
    label: string,
    opts?: {
      onClick?: string | unknown;
      intent?: Intent;
      size?: "sm" | "md" | "lg";
      style?: Record<string, string>;
    },
  ): unknown;

  render(builder: () => unknown): void;
  updateBadge(update: TrayBadgeUpdate): void;
  onOpen(callback: () => void): void;
  onClose(callback: () => void): void;
  onClick(callback: () => void): void;
  /** Programmatically open the tray. NOTE: per official docs, this does
   *  not work on first page load or if the user hasn't pinned the icon. */
  open(): void;
  close(): void;
  update(): void;
}
