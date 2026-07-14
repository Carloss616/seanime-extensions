// Shared GitHub device-flow connect flow, so every plugin's "Connect GitHub"
// looks AND behaves identically. One component renders the whole flow from the
// caller's state (deviceStart / connected / connecting); the buttons + code
// prompt live here so styling is defined once. Pairs with
// _utils/gist/device-flow.ts.
//
// PURE FUNCTION over `tray` so the build can inline it into serialized goja
// callbacks (see CLAUDE.md "Splitting an extension across multiple files").
import { ALERT_MENU_ITEM_STYLE, CAPTION_STYLE, LABEL_STYLE } from "./text";

export interface GithubConnectOptions {
  /** Non-null while a login poll is in flight → the code prompt takes over. */
  deviceStart: $gh.Login.DeviceCode | null;
  /** Uppercase section label above the block (e.g. "Sync"). Hidden while the
   *  code prompt is up. Omit for none. */
  title?: string;
  /** True while a device flow is starting (disables + relabels Connect). */
  connecting: boolean;
  /** True when connected via any auth path (device-flow token or PAT). Shows
   *  the status + connectedActions; the Connect button appears when false. */
  connected: boolean;
  /** True when a Disconnect button should show — i.e. there's a device-flow
   *  token to clear. A PAT is managed in config, so PAT-only connections pass
   *  false (status shows, but no Disconnect). Defaults to `connected`. */
  disconnectable?: boolean;
  /** Event id fired by the Connect button. */
  connectEvent: string;
  /** Event id fired by the Disconnect button. */
  disconnectEvent: string;
  /** Connection status shown above the action row as a badge (+ "· via {via}").
   *  Rendered by the component so wording/style match everywhere; omit for none.
   *  Ignored while the code prompt is up. */
  status?: ConnectStatusInput;
  /** Extra items shown in the connected-state ⋮ dropdown, before Disconnect
   *  (e.g. a "Sync now" action). */
  connectedActions?: { label: string; onClick: string; disabled?: boolean }[];
  /** Small caption under the Connect button when disconnected (e.g. a hint
   *  that a PAT config field is an alternative). */
  connectHint?: string;
}

export interface ConnectStatusInput {
  /** Connected via any auth path (device-flow token or PAT). */
  connected: boolean;
  /** A sync is running right now. */
  syncing?: boolean;
  /** Last successful sync (ms epoch). >0 → "Synced", else "Connected". */
  lastSyncedAt?: number;
  /** Auth channel, e.g. "GitHub login" / "PAT". Rendered as "· via {via}". */
  via?: string;
}

export interface ConnectStatus {
  /** State word shown as a badge; null when the state is plain text. */
  badge: { label: string; intent: $ui.BadgeComponentIntent } | null;
  /** Plain-text state (the "Syncing…" case) — no badge. */
  text: string | null;
  /** Auth channel for the "· via {via}" suffix; "" when none. */
  via: string;
}

// Shared status model so every plugin's connect UI reads identically:
//   Not connected            → gray badge
//   Syncing…                 → plain text (transient, no badge)
//   Connected · via {via}    → success badge + dim suffix
//   Synced · via {via}       → success badge + dim suffix
export function connectStatus(o: ConnectStatusInput): ConnectStatus {
  if (!o.connected)
    return {
      badge: { label: "Not connected", intent: "gray" },
      text: null,
      via: "",
    };
  if (o.syncing) return { badge: null, text: "Syncing…", via: "" };
  const label = o.lastSyncedAt && o.lastSyncedAt > 0 ? "Synced" : "Connected";
  return { badge: { label, intent: "success" }, text: null, via: o.via ?? "" };
}

// Same fixed-height inline-flex box entry-list uses for its sub-line: a bare
// span rides a taller line box than the 1.2rem badge, so under align-items:
// center its text lands a couple px off the badge. This box makes centers match
// (see entry-list.ts SEG_BOX + the lineHeight:1 note).
const SEG_BOX: Record<string, string> = {
  display: "inline-flex",
  alignItems: "center",
  height: "1.2rem",
  lineHeight: "1",
};

// Badge (or plain text) + optional "· via {via}" suffix, all vertically
// centered on one line.
function statusRow(tray: $ui.Tray, s: ConnectStatus): unknown {
  const segs: unknown[] = [];
  if (s.badge) {
    segs.push(tray.badge(s.badge.label, { intent: s.badge.intent }));
  }
  if (s.text) {
    segs.push(
      tray.span(s.text, {
        style: { ...SEG_BOX, fontSize: "0.7rem", opacity: "0.7" },
      }),
    );
  }
  if (s.via) {
    segs.push(
      tray.span(`· via ${s.via}`, {
        style: {
          ...SEG_BOX,
          fontSize: "0.7rem",
          opacity: "0.55",
          marginLeft: "6px",
        },
      }),
    );
  }
  return tray.flex(segs, {
    gap: 0,
    style: { alignItems: "center", lineHeight: "1" },
  });
}

// The device-flow "enter this code at GitHub" prompt. The button can't open the
// tab itself (an anchor's href is suppressed when it also has onClick, and
// there's no open-URL API), so the user taps the anchor.
function deviceCodePrompt(
  tray: $ui.Tray,
  start: $gh.Login.DeviceCode,
): unknown {
  return tray.stack(
    [
      tray.flex(
        [
          tray.text("Enter this code at GitHub", { style: CAPTION_STYLE }),
          tray.text(start.user_code, {
            style: {
              fontSize: "1.25rem",
              fontWeight: "700",
              letterSpacing: "0.15em",
            },
          }),
        ],
        { direction: "column", gap: 1 },
      ),
      tray.anchor({
        text: "Open GitHub ↗",
        href: start.verification_uri,
        target: "_blank",
      }),
      tray.text("Waiting for authorization…", { style: CAPTION_STYLE }),
    ],
    { gap: 2 },
  );
}

// Connected-state actions collapsed into a ⋮ dropdown (connectedActions, then
// Disconnect). Returns null when there's nothing to offer (PAT-only, no extra
// actions) so the header shows just the status.
function actionsMenu(tray: $ui.Tray, o: GithubConnectOptions): unknown {
  // dropdownMenuItem's `item` must be a tray node, not a raw string.
  const items: unknown[] = (o.connectedActions ?? []).map((a) =>
    tray.dropdownMenuItem(tray.text(a.label), {
      onClick: a.onClick,
      disabled: a.disabled,
    }),
  );
  if (o.disconnectable ?? o.connected) {
    items.push(
      tray.dropdownMenuItem(tray.text("Disconnect"), {
        className: ALERT_MENU_ITEM_STYLE,
        onClick: o.disconnectEvent,
      }),
    );
  }
  if (!items.length) return null;
  return tray.dropdownMenu({
    trigger: tray.button("⋮", { size: "sm", intent: "gray-subtle" }),
    items,
  });
}

// Full connect flow: code prompt while a login is in flight, else a header row
// (title · status · ⋮ actions menu) with, when disconnected, a Connect button
// below.
export function githubConnect(
  tray: $ui.Tray,
  o: GithubConnectOptions,
): unknown {
  if (o.deviceStart) return deviceCodePrompt(tray, o.deviceStart);

  const rows: unknown[] = [];
  const status = o.status ? statusRow(tray, connectStatus(o.status)) : null;
  const menu = o.connected ? actionsMenu(tray, o) : null;

  // Header: title (flex-1) pushes status + the ⋮ menu to the far right on one
  // row — same header layout as entry-list.
  if (o.title || status || menu) {
    const header: unknown[] = [
      tray.div(o.title ? [tray.text(o.title, { style: LABEL_STYLE })] : [], {
        style: { flex: "1", alignSelf: "center" },
      }),
    ];
    if (status) header.push(status);
    if (menu) header.push(menu);
    rows.push(tray.flex(header, { gap: 2, style: { alignItems: "center" } }));
  }

  if (!o.connected) {
    // Wrap in a flex row so the button hugs its content instead of stretching
    // full-width (a bare stack child fills the row).
    rows.push(
      tray.flex(
        [
          tray.button(o.connecting ? "Connecting…" : "Connect GitHub", {
            onClick: o.connectEvent,
            size: "sm",
            intent: "primary",
            loading: o.connecting,
          }),
        ],
        { gap: 2 },
      ),
    );
    if (o.connectHint) {
      rows.push(tray.text(o.connectHint, { style: CAPTION_STYLE }));
    }
  }
  return tray.stack(rows, { gap: 2 });
}
