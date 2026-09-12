(function playlistExporterExtensionBootstrap() {
  const RETRY_MS = 150;

  function ready() {
    const s = globalThis.Spicetify;
    return Boolean(
      s?.React &&
      s?.ReactDOM &&
      s?.Platform &&
      s?.CosmosAsync &&
      s?.LocalStorage &&
      s?.PopupModal &&
      s?.Topbar?.Button
    );
  }

  function init() {
    if (!ready()) {
      setTimeout(init, RETRY_MS);
      return;
    }
    if (window.__playlistExporterV4ExtensionLoaded) return;
    window.__playlistExporterV4ExtensionLoaded = true;

// Playlist Exporter 4.2.6 — Extension build
// Spicetify extension: per-playlist CSV profiles, scheduling, presets, persistent summaries, album art export.

const React = Spicetify.React;
const { useState, useEffect, useCallback, useMemo, useRef } = React;
const h = React.createElement;

const STORAGE_KEY = "playlist-exporter-config-v4";
const LEGACY_STORAGE_KEYS = ["playlist-exporter-config-v3", "playlist-exporter-config-v2", "playlist-exporter-config"];
const HANDLE_DB_NAME = "playlist-exporter-file-handles-v4";
const HANDLE_STORE_NAME = "handles";
const LEGACY_HANDLE_DB_NAME = "playlist-exporter-file-handles";
const LEGACY_HANDLE_STORE_NAME = "handles";
const LEGACY_HANDLE_KEY = "export-directory";
const ROOTLIST_ENDPOINT = "sp://core-playlist/v1/rootlist";
const LIBRARY_REFRESH_MS = 60 * 1000;
const SCHEDULER_TICK_MS = 30 * 1000;
const COVER_SUBFOLDER_NAME = "covers";

const PROJECT_URL = "https://github.com/Yumppe/spicetify-playlist-exporter";
const BUG_REPORT_URL = `${PROJECT_URL}/issues/new?template=bug_report.md`;
const FEATURE_REQUEST_URL = `${PROJECT_URL}/issues/new?template=feature_request.md`;

const DEFAULT_COLUMNS = ["track_name", "artists", "duration", "album_name", "release_date"];

const COLUMN_DEFS = [
  { id: "track_name", label: "Track name", group: "Basic", value: (t) => t.name || "" },
  { id: "artists", label: "Artists", group: "Basic", value: (t) => (t.artists || []).join(", ") },
  { id: "primary_artist", label: "Primary artist", group: "Basic", value: (t) => t.artists?.[0] || "" },
  { id: "genres", label: "Genres", group: "Artist", value: (t) => (t.genres || []).join(", ") },
  { id: "duration", label: "Duration", group: "Basic", value: (t) => formatTrackDuration(t.duration_ms) },
  { id: "album_name", label: "Album name", group: "Album", value: (t) => t.album_name || "" },
  { id: "album_type", label: "Album type", group: "Album", value: (t) => t.album_type || "" },
  { id: "release_date", label: "Release date", group: "Album", value: (t) => t.release_date || "" },
  { id: "release_year", label: "Release year", group: "Album", value: (t) => t.release_date ? String(t.release_date).slice(0, 4) : "" },
  { id: "album_art_url", label: "Album art URL", group: "Album", value: (t) => t.album_image_url || "" },
  { id: "track_number", label: "Track number", group: "Track details", value: (t) => t.track_number ?? "" },
  { id: "disc_number", label: "Disc number", group: "Track details", value: (t) => t.disc_number ?? "" },
  { id: "explicit", label: "Explicit", group: "Track details", value: (t) => t.explicit == null ? "" : (t.explicit ? "Yes" : "No") },
  { id: "isrc", label: "ISRC", group: "Track details", value: (t) => t.isrc || "" },
  { id: "spotify_track_id", label: "Spotify track ID", group: "Identifiers", value: (t) => t.id || "" },
  { id: "spotify_uri", label: "Spotify URI", group: "Identifiers", value: (t) => t.uri || "" },
  { id: "spotify_url", label: "Spotify URL", group: "Identifiers", value: (t) => t.spotify_url || (t.id ? `https://open.spotify.com/track/${t.id}` : "") },
  { id: "playlist_position", label: "Original playlist position", group: "Playlist", value: (t) => t.playlist_position ?? "" },
  { id: "date_added", label: "Date added", group: "Playlist", value: (t) => t.added_at || "" },
  { id: "added_by", label: "Added by", group: "Playlist", value: (t) => t.added_by || "" },
  { id: "local_track", label: "Local track", group: "Availability", value: (t) => t.is_local ? "Yes" : "No" },
  { id: "playable", label: "Playable", group: "Availability", value: (t) => t.is_playable == null ? "" : (t.is_playable ? "Yes" : "No") },
  { id: "restriction", label: "Restriction", group: "Availability", value: (t) => t.restriction || "" },
  { id: "key", label: "Key", group: "Audio analysis", value: (t) => t.audio_key ?? "" },
  { id: "loudness", label: "Loudness", group: "Audio analysis", value: (t) => t.loudness ?? "" },
  { id: "mode", label: "Mode", group: "Audio analysis", value: (t) => t.mode ?? "" },
  { id: "tempo", label: "Tempo", group: "Audio analysis", value: (t) => t.tempo ?? "" },
  { id: "time_signature", label: "Time signature", group: "Audio analysis", value: (t) => t.time_signature ?? "" }
];
const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((column) => [column.id, column]));
const ALL_COLUMN_IDS = COLUMN_DEFS.map((column) => column.id);
const AUDIO_ANALYSIS_COLUMN_IDS = new Set(["key", "loudness", "mode", "tempo", "time_signature"]);
const ARTIST_GENRE_CACHE = new Map();
const AUDIO_ANALYSIS_CACHE = new Map();

const SORT_FIELDS = [
  ["primary_artist", "Primary artist"],
  ["track_name", "Track name"],
  ["album_name", "Album name"],
  ["release_date", "Release date"],
  ["duration", "Duration"],
  ["playlist_position", "Playlist order"],
  ["date_added", "Date added"],
  ["none", "None"]
];

const BUILTIN_PRESETS = [
  {
    id: "builtin-default",
    name: "Default",
    builtin: true,
    settings: {
      columns: DEFAULT_COLUMNS,
      sortPrimary: "primary_artist",
      sortPrimaryDirection: "asc",
      sortSecondary: "track_name",
      sortSecondaryDirection: "asc",
      filenameTemplate: "{playlist_name}.csv",
      overwriteBehavior: "replace",
      duplicateMode: "keep"
    }
  },
  {
    id: "builtin-minimal",
    name: "Minimal",
    builtin: true,
    settings: {
      columns: ["track_name", "artists", "duration"],
      sortPrimary: "primary_artist",
      sortPrimaryDirection: "asc",
      sortSecondary: "track_name",
      sortSecondaryDirection: "asc",
      filenameTemplate: "{playlist_name}.csv",
      overwriteBehavior: "replace",
      duplicateMode: "keep"
    }
  },
  {
    id: "builtin-full",
    name: "Full metadata",
    builtin: true,
    settings: {
      columns: ALL_COLUMN_IDS,
      sortPrimary: "primary_artist",
      sortPrimaryDirection: "asc",
      sortSecondary: "track_name",
      sortSecondaryDirection: "asc",
      filenameTemplate: "{playlist_name}_{date}.csv",
      overwriteBehavior: "timestamp",
      duplicateMode: "recording"
    }
  }
];

const APP_CSS = `
.pe4-app {
  --pe-accent: var(--spice-button, #1ed760);
  --pe-text: var(--spice-text, #fff);
  --pe-muted: var(--spice-subtext, #b3b3b3);
  --pe-panel: rgba(255,255,255,.045);
  --pe-panel-2: rgba(255,255,255,.065);
  --pe-border: rgba(255,255,255,.11);
  --pe-border-strong: rgba(255,255,255,.18);
  max-width: 1480px;
  margin: 0 auto;
  padding: 76px 30px 64px;
  color: var(--pe-text);
  box-sizing: border-box;
}
.pe4-app * { box-sizing: border-box; }

.pe4-app,
.pe4-app button,
.pe4-app a,
.pe4-app input,
.pe4-app select,
.pe4-app textarea,
.pe4-app label,
.pe4-app [role="button"] {
  -webkit-app-region: no-drag !important;
}
.pe4-header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:22px; }
.pe4-title-wrap { display:flex; gap:14px; align-items:center; min-width:0; }
.pe4-logo { width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:var(--pe-accent); color:#000; flex:0 0 auto; }
.pe4-title { margin:0; font-size:28px; line-height:1.1; font-weight:800; letter-spacing:-.45px; }
.pe4-subtitle { margin:7px 0 0; color:var(--pe-muted); font-size:13px; line-height:1.45; }
.pe4-status { display:inline-flex; align-items:center; gap:8px; padding:7px 11px; border:1px solid var(--pe-border); border-radius:999px; color:var(--pe-muted); font-size:12px; white-space:nowrap; background:rgba(0,0,0,.15); }
.pe4-status-dot { width:7px; height:7px; border-radius:50%; background:#7f7f7f; }
.pe4-status[data-state="idle"] .pe4-status-dot, .pe4-status[data-state="done"] .pe4-status-dot { background:var(--pe-accent); }
.pe4-status[data-state="loading"] .pe4-status-dot, .pe4-status[data-state="exporting"] .pe4-status-dot { background:#65aaff; }
.pe4-status[data-state="error"] .pe4-status-dot { background:#ff6d6d; }
.pe4-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:11px; margin-bottom:16px; }
.pe4-stat { border:1px solid var(--pe-border); background:var(--pe-panel); border-radius:12px; padding:14px 16px; min-height:82px; }
.pe4-stat-label { color:var(--pe-muted); text-transform:uppercase; letter-spacing:.06em; font-size:10.5px; font-weight:750; }
.pe4-stat-value { margin-top:8px; font-size:20px; font-weight:780; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pe4-banner { margin-bottom:16px; padding:11px 13px; border:1px solid var(--pe-border); background:var(--pe-panel); border-radius:10px; font-size:12.5px; line-height:1.5; }
.pe4-banner[data-kind="error"] { border-color:rgba(255,105,105,.34); background:rgba(255,105,105,.07); }
.pe4-banner[data-kind="success"] { border-color:color-mix(in srgb,var(--pe-accent) 35%,transparent); background:color-mix(in srgb,var(--pe-accent) 7%,transparent); }
.pe4-progress { margin-top:8px; height:4px; background:rgba(255,255,255,.09); border-radius:99px; overflow:hidden; }
.pe4-progress-bar { height:100%; background:var(--pe-accent); transition:width .2s ease; }
.pe4-layout { display:grid; grid-template-columns:minmax(330px,390px) minmax(0,1fr); gap:16px; align-items:start; }
.pe4-panel { border:1px solid var(--pe-border); background:var(--pe-panel); border-radius:14px; overflow:hidden; }
.pe4-panel-head { padding:16px 17px 13px; border-bottom:1px solid var(--pe-border); }
.pe4-panel-title { margin:0; font-size:14px; font-weight:760; }
.pe4-panel-copy { margin:5px 0 0; color:var(--pe-muted); font-size:12px; line-height:1.5; }
.pe4-toolbar { display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:12px; border-bottom:1px solid var(--pe-border); }
.pe4-search-wrap { position:relative; flex:1 1 200px; min-width:180px; }
.pe4-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--pe-muted); pointer-events:none; }
.pe4-input, .pe4-select, .pe4-search { width:100%; min-height:38px; border:1px solid var(--pe-border-strong); border-radius:8px; background:rgba(0,0,0,.18); color:var(--pe-text); outline:none; font:inherit; font-size:12.5px; }
.pe4-input, .pe4-select { padding:0 10px; }
.pe4-search { padding:0 10px 0 34px; }
.pe4-input:focus, .pe4-select:focus, .pe4-search:focus { border-color:color-mix(in srgb,var(--pe-accent) 62%,white 10%); box-shadow:0 0 0 3px color-mix(in srgb,var(--pe-accent) 12%,transparent); }
.pe4-button { text-decoration:none; min-height:36px; border:1px solid var(--pe-border-strong); border-radius:999px; padding:0 13px; display:inline-flex; align-items:center; justify-content:center; gap:7px; background:rgba(255,255,255,.055); color:var(--pe-text); font-size:12px; font-weight:720; cursor:pointer; transition:background .15s,border-color .15s,transform .12s,opacity .15s; }
.pe4-button:hover:not(:disabled) { background:rgba(255,255,255,.10); border-color:rgba(255,255,255,.25); transform:translateY(-1px); }
.pe4-button:disabled { opacity:.46; cursor:default; }
.pe4-button-primary { background:var(--pe-accent); color:#000; border-color:transparent; }
.pe4-button-danger { color:#ff9696; }
.pe4-button-square { min-width:34px; padding:0 9px; border-radius:8px; }
.pe4-list { max-height:700px; overflow:auto; padding:6px; }
.pe4-playlist-row { display:grid; grid-template-columns:22px 46px minmax(0,1fr) auto; gap:10px; align-items:center; padding:8px 9px; border:1px solid transparent; border-radius:10px; cursor:pointer; transition:background .14s,border-color .14s; }
.pe4-playlist-row:hover { background:rgba(255,255,255,.055); }
.pe4-playlist-row[data-active="true"] { background:color-mix(in srgb,var(--pe-accent) 8%,transparent); border-color:color-mix(in srgb,var(--pe-accent) 28%,transparent); }
.pe4-check { width:18px; height:18px; accent-color:var(--pe-accent); cursor:pointer; }
.pe4-cover { width:46px; height:46px; border-radius:7px; object-fit:cover; background:rgba(255,255,255,.07); }
.pe4-cover-fallback { display:grid; place-items:center; color:var(--pe-muted); }
.pe4-row-main { min-width:0; }
.pe4-row-name { font-size:13px; font-weight:720; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.pe4-row-detail { margin-top:4px; font-size:11.3px; color:var(--pe-muted); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.pe4-row-status { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
.pe4-chip { display:inline-flex; align-items:center; border:1px solid var(--pe-border); border-radius:999px; padding:3px 7px; font-size:10px; color:var(--pe-muted); white-space:nowrap; }
.pe4-chip-active { color:var(--pe-text); border-color:color-mix(in srgb,var(--pe-accent) 32%,transparent); background:color-mix(in srgb,var(--pe-accent) 7%,transparent); }
.pe4-empty { padding:38px 22px; text-align:center; color:var(--pe-muted); font-size:12.5px; line-height:1.55; }
.pe4-editor { padding:16px; }
.pe4-editor-header { display:flex; align-items:center; gap:13px; margin-bottom:16px; padding-bottom:15px; border-bottom:1px solid var(--pe-border); }
.pe4-editor-cover { width:58px; height:58px; border-radius:9px; object-fit:cover; background:rgba(255,255,255,.07); }
.pe4-editor-name { margin:0; font-size:18px; font-weight:790; letter-spacing:-.2px; }
.pe4-editor-meta { margin-top:5px; color:var(--pe-muted); font-size:11.8px; }
.pe4-section { border-top:1px solid var(--pe-border); padding:16px 0 2px; }
.pe4-section:first-of-type { border-top:0; padding-top:0; }
.pe4-section-title-row { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:11px; }
.pe4-section-title { margin:0; font-size:12.5px; font-weight:780; }
.pe4-section-note { color:var(--pe-muted); font-size:11.2px; line-height:1.5; }
.pe4-grid-2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.pe4-grid-3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.pe4-field { min-width:0; }
.pe4-label { display:block; margin-bottom:6px; color:var(--pe-muted); font-size:10.8px; font-weight:720; }
.pe4-switch-row { display:flex; justify-content:space-between; gap:18px; align-items:center; border:1px solid var(--pe-border); background:rgba(255,255,255,.025); border-radius:9px; padding:10px 11px; }
.pe4-switch-copy strong { display:block; font-size:12px; }
.pe4-switch-copy span { display:block; color:var(--pe-muted); font-size:10.8px; margin-top:3px; }
.pe4-switch { width:18px; height:18px; accent-color:var(--pe-accent); flex:0 0 auto; }
.pe4-toggle { display:inline-flex; align-items:center; gap:9px; min-height:33px; border:1px solid var(--pe-border-strong); border-radius:999px; padding:5px 14px 5px 11px; background:rgba(255,255,255,.055); color:var(--pe-text); font-size:12px; font-weight:720; cursor:pointer; flex:0 0 auto; transition:background .15s,border-color .15s,transform .12s,box-shadow .15s; }
.pe4-toggle:hover { background:rgba(255,255,255,.095); transform:translateY(-1px); box-shadow:0 3px 10px rgba(0,0,0,.22); }
.pe4-toggle:active { transform:translateY(0) scale(.97); box-shadow:none; }
.pe4-toggle:focus-visible { outline:2px solid var(--pe-accent); outline-offset:2px; }
.pe4-toggle-track { position:relative; display:inline-block; width:34px; height:19px; border-radius:999px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.12); transition:background .18s ease; flex:0 0 auto; }
.pe4-toggle-track::after { content:""; position:absolute; top:2px; left:2.5px; width:13px; height:13px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.45); transition:left .18s cubic-bezier(.4,0,.2,1); }
.pe4-toggle[data-on="true"] .pe4-toggle-track { background:var(--pe-accent); border-color:transparent; }
.pe4-toggle[data-on="true"] .pe4-toggle-track::after { left:16.5px; }
.pe4-toggle-state { min-width:20px; font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--pe-muted); transition:color .18s; }
.pe4-toggle[data-on="true"] .pe4-toggle-state { color:var(--pe-accent); }
.pe4-column-groups { display:grid; gap:12px; }
.pe4-column-block { border:1px solid var(--pe-border); border-radius:10px; background:rgba(0,0,0,.10); padding:9px; }
.pe4-column-block-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:1px 2px 8px; }
.pe4-column-block-title { font-size:10.8px; font-weight:760; color:var(--pe-muted); text-transform:uppercase; letter-spacing:.055em; }
.pe4-column-block-count { font-size:10.5px; color:var(--pe-muted); }
.pe4-selected-columns { display:flex; flex-direction:column; gap:6px; }
.pe4-available-columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
.pe4-column-row { min-height:46px; display:grid; grid-template-columns:30px 30px minmax(0,1fr) 30px 30px; align-items:center; gap:7px; padding:6px 7px; border:1px solid var(--pe-border); border-radius:9px; background:rgba(255,255,255,.025); transition:background .14s,border-color .14s,transform .14s; }
.pe4-column-row:hover { background:rgba(255,255,255,.045); border-color:var(--pe-border-strong); }
.pe4-column-index { width:28px; height:28px; display:grid; place-items:center; border-radius:7px; background:color-mix(in srgb,var(--pe-accent) 12%,transparent); color:var(--pe-text); font-size:10.5px; font-weight:800; font-variant-numeric:tabular-nums; }
.pe4-column-toggle { width:28px; height:28px; display:grid; place-items:center; border:1px solid color-mix(in srgb,var(--pe-accent) 45%,var(--pe-border)); border-radius:8px; background:color-mix(in srgb,var(--pe-accent) 12%,transparent); color:var(--pe-text); cursor:pointer; padding:0; font:inherit; font-size:14px; font-weight:850; transition:background .14s,border-color .14s,transform .12s; }
.pe4-column-toggle:hover { background:color-mix(in srgb,var(--pe-accent) 20%,transparent); border-color:color-mix(in srgb,var(--pe-accent) 70%,white 5%); transform:translateY(-1px); }
.pe4-column-copy { min-width:0; }
.pe4-column-label { display:block; font-size:11.8px; font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pe4-column-group { display:block; margin-top:2px; color:var(--pe-muted); font-size:9.8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pe4-order-button { width:30px; height:28px; border:1px solid var(--pe-border); border-radius:8px; background:rgba(255,255,255,.025); color:var(--pe-muted); cursor:pointer; padding:0; font:inherit; font-size:13px; transition:background .14s,border-color .14s,color .14s,transform .12s; }
.pe4-order-button:hover:not(:disabled) { color:var(--pe-text); background:rgba(255,255,255,.08); border-color:var(--pe-border-strong); transform:translateY(-1px); }
.pe4-order-button:disabled { opacity:.22; cursor:default; }
.pe4-column-available { min-height:42px; display:grid; grid-template-columns:30px minmax(0,1fr); align-items:center; gap:8px; padding:6px 7px; border:1px solid var(--pe-border); border-radius:9px; background:rgba(255,255,255,.018); color:var(--pe-text); font:inherit; text-align:left; cursor:pointer; transition:background .14s,border-color .14s,transform .12s; }
.pe4-column-available:hover { background:rgba(255,255,255,.05); border-color:var(--pe-border-strong); transform:translateY(-1px); }
.pe4-column-add { width:28px; height:28px; display:grid; place-items:center; border:1px solid var(--pe-border-strong); border-radius:8px; background:rgba(255,255,255,.035); color:var(--pe-muted); font-size:17px; font-weight:600; }
.pe4-column-available:hover .pe4-column-add { color:var(--pe-text); border-color:color-mix(in srgb,var(--pe-accent) 45%,var(--pe-border)); background:color-mix(in srgb,var(--pe-accent) 10%,transparent); }
.pe4-column-toggle:focus-visible, .pe4-order-button:focus-visible, .pe4-column-available:focus-visible { outline:2px solid color-mix(in srgb,var(--pe-accent) 68%,white 8%); outline-offset:2px; }
.pe4-column-empty { padding:9px 8px; color:var(--pe-muted); font-size:10.8px; text-align:center; }
.pe4-preview { border:1px solid var(--pe-border); border-radius:9px; background:rgba(0,0,0,.17); overflow:hidden; }
.pe4-preview-file { padding:9px 11px; border-bottom:1px solid var(--pe-border); font-size:11.5px; font-weight:700; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.pe4-preview-scroll { overflow:auto; }
.pe4-preview-table { width:100%; border-collapse:collapse; min-width:540px; font-size:10.8px; }
.pe4-preview-table th, .pe4-preview-table td { text-align:left; padding:8px 9px; border-right:1px solid var(--pe-border); white-space:nowrap; }
.pe4-preview-table th:last-child, .pe4-preview-table td:last-child { border-right:0; }
.pe4-preview-table th { color:var(--pe-muted); font-weight:700; border-bottom:1px solid var(--pe-border); }
.pe4-note { padding:9px 10px; border-radius:8px; background:rgba(255,255,255,.035); color:var(--pe-muted); font-size:10.8px; line-height:1.5; }
.pe4-preset-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }
.pe4-preset-save { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; margin-top:8px; }
.pe4-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:15px; padding-top:14px; border-top:1px solid var(--pe-border); }
.pe4-actions .pe4-button-primary { flex:1 1 180px; }
.pe4-header-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; justify-content:flex-end; }
.pe4-settings-wrap { max-width:980px; margin:0 auto; }
.pe4-settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.pe4-settings-card { border:1px solid var(--pe-border); background:var(--pe-panel); border-radius:14px; padding:18px; }
.pe4-settings-card h2 { margin:0 0 6px; font-size:15px; }
.pe4-settings-card p { margin:0; color:var(--pe-muted); font-size:12px; line-height:1.55; }
.pe4-settings-row { display:flex; justify-content:space-between; gap:18px; padding:11px 0; border-bottom:1px solid var(--pe-border); font-size:12px; }
.pe4-settings-row:last-child { border-bottom:0; padding-bottom:0; }
.pe4-settings-row strong { font-weight:720; }
.pe4-settings-value { color:var(--pe-muted); text-align:right; }
.pe4-settings-wide { grid-column:1 / -1; }
@media (max-width:1100px) { .pe4-layout{grid-template-columns:320px minmax(0,1fr)} .pe4-available-columns{grid-template-columns:1fr} }
@media (max-width:850px) { .pe4-stats{grid-template-columns:repeat(2,minmax(0,1fr))} .pe4-layout{grid-template-columns:1fr} .pe4-list{max-height:380px} }
@media (max-width:600px) { .pe4-app{padding:76px 16px 48px} .pe4-header{flex-direction:column} .pe4-grid-2,.pe4-grid-3,.pe4-available-columns{grid-template-columns:1fr} }
`;

const ICONS = {
  download: '<path d="M12 3v10m0 0 4-4m-4 4-4-4M5 16v4h14v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  refresh: '<path d="M19 8a7 7 0 1 0 .2 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 4v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  playlist: '<path d="M5 6h9M5 11h9M5 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17 13v6m0 0c0 1.1-1 2-2.2 2S13 20.3 13 19.4s.8-1.6 1.8-1.6c.8 0 1.5.3 2.2.7V11l4-1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3.5 7.5h6l1.8 2H20.5v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.5 7.5V6a2 2 0 0 1 2-2h4l1.8 2h7.2a2 2 0 0 1 2 2v1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  close: '<path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m5.5 17 4-4L12 15.5l2.8-2.8L19 16.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.64 8.94a1.7 1.7 0 0 0-.34-1.88L4.24 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10.03 3H10V3h4v.08A1.7 1.7 0 0 0 15.03 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7.07l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
};

function Icon({ name, size = 18 }) {
  return h("svg", { width:size, height:size, viewBox:"0 0 24 24", "aria-hidden":true, focusable:false, dangerouslySetInnerHTML:{ __html:ICONS[name] || ICONS.playlist } });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function defaultProfile() {
  return {
    columns: [...DEFAULT_COLUMNS],
    sortPrimary: "primary_artist",
    sortPrimaryDirection: "asc",
    sortSecondary: "track_name",
    sortSecondaryDirection: "asc",
    filenameTemplate: "{playlist_name}.csv",
    overwriteBehavior: "replace",
    duplicateMode: "keep",
    downloadCovers: false,
    exportDestination: "downloads",
    downloadFolderName: "",
    autoEnabled: false,
    exportIntervalHours: 2,
    autoEnabledSince: null,
    lastAttemptTime: null,
    lastExportTime: null,
    exportCount: 0,
    presetId: "builtin-default"
  };
}

function normalizeProfile(profile) {
  const base = defaultProfile();
  const merged = { ...base, ...(profile || {}) };
  merged.columns = Array.isArray(profile?.columns) && profile.columns.length
    ? profile.columns.filter((id) => COLUMN_MAP[id])
    : [...DEFAULT_COLUMNS];
  if (!merged.columns.length) merged.columns = [...DEFAULT_COLUMNS];
  if (!["keep","exact","recording"].includes(merged.duplicateMode)) merged.duplicateMode = "keep";
  merged.downloadCovers = Boolean(merged.downloadCovers);
  if (!["replace","timestamp","increment"].includes(merged.overwriteBehavior)) merged.overwriteBehavior = "replace";
  if (!["downloads","folder"].includes(merged.exportDestination)) merged.exportDestination = "downloads";
  if (!["asc","desc"].includes(merged.sortPrimaryDirection)) merged.sortPrimaryDirection = "asc";
  if (!["asc","desc"].includes(merged.sortSecondaryDirection)) merged.sortSecondaryDirection = "asc";
  if (!SORT_FIELDS.some(([id]) => id === merged.sortPrimary)) merged.sortPrimary = "primary_artist";
  if (!SORT_FIELDS.some(([id]) => id === merged.sortSecondary)) merged.sortSecondary = "track_name";
  merged.exportIntervalHours = Number(merged.exportIntervalHours) > 0 ? Number(merged.exportIntervalHours) : 2;
  return merged;
}

function defaultConfig() {
  return { selectedPlaylistIds: [], playlistProfiles: {}, customPresets: [], lastAnyExportTime: null, totalExportedFiles: 0 };
}

function migrateLegacyConfig(parsed) {
  const base = defaultConfig();
  if (!parsed) return base;
  if (parsed.playlistProfiles) {
    const profiles = {};
    for (const [id, profile] of Object.entries(parsed.playlistProfiles)) profiles[id] = normalizeProfile(profile);
    return {
      ...base,
      ...parsed,
      selectedPlaylistIds: Array.isArray(parsed.selectedPlaylistIds) ? parsed.selectedPlaylistIds : [],
      playlistProfiles: profiles,
      customPresets: Array.isArray(parsed.customPresets) ? parsed.customPresets : []
    };
  }
  const selected = Array.isArray(parsed.selectedPlaylistIds) ? parsed.selectedPlaylistIds : [];
  const profiles = {};
  for (const id of selected) {
    profiles[id] = normalizeProfile({
      exportIntervalHours: Number(parsed.exportIntervalHours) || 2,
      exportDestination: parsed.exportDestination === "folder" ? "folder" : "downloads",
      downloadFolderName: parsed.downloadFolderName || "",
      autoEnabled: true,
      autoEnabledSince: Date.now(),
      lastExportTime: parsed.lastExportTime || null,
      exportCount: parsed.exportCount || 0
    });
  }
  return { ...base, selectedPlaylistIds:selected, playlistProfiles:profiles, lastAnyExportTime:parsed.lastExportTime || null, totalExportedFiles:parsed.exportCount || 0 };
}

function loadConfig() {
  try {
    let raw = Spicetify.LocalStorage.get(STORAGE_KEY);
    if (raw) return migrateLegacyConfig(JSON.parse(raw));
    for (const key of LEGACY_STORAGE_KEYS) {
      raw = Spicetify.LocalStorage.get(key);
      if (raw) {
        const migrated = migrateLegacyConfig(JSON.parse(raw));
        saveConfig(migrated);
        return migrated;
      }
    }
  } catch (error) { console.warn("[Playlist Exporter] Could not load config:", error); }
  return defaultConfig();
}

function saveConfig(config) {
  Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(config));
}

function getProfile(config, playlistId) { return normalizeProfile(config.playlistProfiles?.[playlistId]); }
function withProfile(config, playlistId, updater) {
  const previous = getProfile(config, playlistId);
  const next = normalizeProfile(typeof updater === "function" ? updater(previous) : updater);
  return { ...config, playlistProfiles:{ ...config.playlistProfiles, [playlistId]:next } };
}

function openHandleDatabase(dbName = HANDLE_DB_NAME, storeName = HANDLE_STORE_NAME) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB is unavailable in this Spotify build."));
    const request = window.indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open folder-handle storage."));
  });
}

async function saveDirectoryHandleForPlaylist(playlistId, handle) {
  const db = await openHandleDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
      tx.objectStore(HANDLE_STORE_NAME).put(handle, `playlist:${playlistId}`);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function loadDirectoryHandleForPlaylist(playlistId) {
  try {
    const db = await openHandleDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
        const request = tx.objectStore(HANDLE_STORE_NAME).get(`playlist:${playlistId}`);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch { return null; }
}

async function clearDirectoryHandleForPlaylist(playlistId) {
  try {
    const db = await openHandleDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
        tx.objectStore(HANDLE_STORE_NAME).delete(`playlist:${playlistId}`);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch {}
}

async function tryMigrateLegacyFolderHandles(config) {
  const folderProfileIds = Object.entries(config.playlistProfiles || {})
    .filter(([,profile]) => profile?.exportDestination === "folder")
    .map(([id]) => id);
  if (!folderProfileIds.length) return;
  let legacyHandle = null;
  try {
    const db = await openHandleDatabase(LEGACY_HANDLE_DB_NAME, LEGACY_HANDLE_STORE_NAME);
    try {
      legacyHandle = await new Promise((resolve, reject) => {
        const tx = db.transaction(LEGACY_HANDLE_STORE_NAME, "readonly");
        const request = tx.objectStore(LEGACY_HANDLE_STORE_NAME).get(LEGACY_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch {}
  if (!legacyHandle) return;
  for (const id of folderProfileIds) {
    const existing = await loadDirectoryHandleForPlaylist(id);
    if (!existing) await saveDirectoryHandleForPlaylist(id, legacyHandle);
  }
}

async function queryDirectoryPermission(handle) {
  if (!handle?.queryPermission) return "unknown";
  try { return await handle.queryPermission({ mode:"readwrite" }); } catch { return "unknown"; }
}
async function ensureDirectoryPermission(handle, allowPrompt) {
  if (!handle) return false;
  const current = await queryDirectoryPermission(handle);
  if (current === "granted") return true;
  if (!allowPrompt || !handle.requestPermission) return false;
  try { return (await handle.requestPermission({ mode:"readwrite" })) === "granted"; } catch { return false; }
}

async function cosmosGet(url, body) { return await Spicetify.CosmosAsync.get(url, body); }
function firstDefined(...values) { for (const value of values) if (value !== undefined && value !== null && value !== "") return value; return null; }
function numericValue(...values) {
  const value = firstDefined(...values);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object") {
    if (Number.isFinite(value.milliseconds)) return value.milliseconds;
    if (Number.isFinite(value.ms)) return value.ms;
  }
  return null;
}
function maxNumericValue(...values) { const nums=values.map((v)=>numericValue(v)).filter((v)=>v!=null); return nums.length ? Math.max(...nums) : null; }

function normalizeUri(value) {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("spotify:playlist:")) return value;
  if (value.startsWith("spotify:playlist-v2:")) { const id=value.split(":").pop(); return id ? `spotify:playlist:${id}` : ""; }
  if (value.startsWith("https://open.spotify.com/playlist/")) { const id=value.split("/playlist/")[1]?.split(/[?/#]/)[0]; return id ? `spotify:playlist:${id}` : ""; }
  const parts=value.split(":"); const idx=parts.findIndex((p)=>p==="playlist" || p==="playlist-v2");
  return idx>=0 && parts[idx+1] ? `spotify:playlist:${parts[idx+1]}` : "";
}
function getPlaylistId(uri) { const normalized=normalizeUri(uri); return normalized ? normalized.split(":").pop() : ""; }
function idFromUri(uri,type) { if (!uri || typeof uri!=="string") return null; const parts=uri.split(":"); const idx=parts.indexOf(type); return idx>=0 && parts[idx+1] ? parts[idx+1] : null; }
function spotifyImageUrl(value) { if (!value || typeof value!=="string") return ""; if (/^https?:\/\//i.test(value)) return value; if (value.startsWith("spotify:image:")) return `https://i.scdn.co/image/${value.split(":").pop()}`; return ""; }
function pickAlbumImageUrl(images) {
  const list=Array.isArray(images)?images.filter((image)=>image&&typeof image.url==="string"&&image.url):[];
  if(!list.length)return "";
  const sorted=[...list].sort((a,b)=>(Number(b.width)||0)-(Number(a.width)||0));
  return spotifyImageUrl(sorted[0].url);
}

function flattenRootlist(rows) {
  const output=[];
  const walk=(items)=>{ if(!Array.isArray(items))return; for(const row of items){ if(!row)continue; if(row.type==="playlist")output.push(row); const children=row.rows||row.items||row.children; if(row.type==="folder"&&Array.isArray(children))walk(children); } };
  walk(rows); return output;
}
async function getRootlistRows() {
  const sources=[];
  try { const root=await cosmosGet(ROOTLIST_ENDPOINT); sources.push(...flattenRootlist(root?.rows||root?.items||[])); } catch(error){ console.warn("[Playlist Exporter] Cosmos rootlist failed:",error); }
  if (Spicetify.Platform?.RootlistAPI?.getContents) {
    try { const root=await Spicetify.Platform.RootlistAPI.getContents(); sources.push(...flattenRootlist(root?.items||root?.rows||[])); } catch(error){ console.warn("[Playlist Exporter] Platform rootlist failed:",error); }
  }
  const unique=new Map();
  for(const row of sources){ const uri=normalizeUri(row?.link||row?.uri||row?.playlist?.uri||row?.playlist?.link); const id=getPlaylistId(uri); if(id&&!unique.has(id))unique.set(id,row); }
  return Array.from(unique.values());
}
function normalizePlaylistMetadata(row,metadata,webData) {
  const uri=normalizeUri(row?.link||row?.uri||row?.playlist?.uri||row?.playlist?.link||metadata?.uri||metadata?.link||webData?.uri);
  const id=getPlaylistId(uri);
  const owner=metadata?.owner||metadata?.playlist?.owner||row?.owner||row?.playlist?.owner||webData?.owner||{};
  const ownerName=firstDefined(owner?.display_name,owner?.name,owner?.username,row?.ownerName,"Unknown owner");
  const image=firstDefined(metadata?.images?.[0]?.url,metadata?.image?.url,metadata?.picture,metadata?.playlist?.picture,row?.picture,row?.image,row?.images?.[0]?.url,webData?.images?.[0]?.url);
  const trackCount=maxNumericValue(metadata?.totalLength,metadata?.length,metadata?.playlist?.length,metadata?.items?.total,metadata?.tracks?.total,row?.totalLength,row?.length,row?.items?.total,row?.tracks?.total,webData?.items?.total,webData?.tracks?.total);
  return { id,uri,name:firstDefined(metadata?.name,metadata?.playlist?.name,row?.name,row?.playlist?.name,webData?.name,"Untitled playlist"),ownerName,image:spotifyImageUrl(image),trackCount };
}
async function enrichPlaylist(row) {
  const baseUri=normalizeUri(row?.link||row?.uri||row?.playlist?.uri||row?.playlist?.link); const id=getPlaylistId(baseUri); if(!id)return null;
  let metadata=null,webData=null;
  if(Spicetify.Platform?.PlaylistAPI?.getMetadata){ try{metadata=await Spicetify.Platform.PlaylistAPI.getMetadata(baseUri);}catch{} }
  try{webData=await cosmosGet(`https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}?fields=id,name,uri,images,owner,items(total),tracks(total)`);}catch{}
  if(!metadata){ try{const internal=await cosmosGet(`sp://core-playlist/v1/playlist/${baseUri}/metadata`,{policy:{name:true,picture:true}});metadata=internal?.metadata||internal?.playlist||internal;}catch{} }
  return normalizePlaylistMetadata(row,metadata,webData);
}
async function fetchLibraryPlaylists() {
  const rootRows=await getRootlistRows();
  if(!rootRows.length)return{playlists:[]};
  const playlists=new Array(rootRows.length); let cursor=0; const concurrency=5;
  async function worker(){while(cursor<rootRows.length){const i=cursor++;try{const p=await enrichPlaylist(rootRows[i]);if(p?.id)playlists[i]=p;}catch(error){console.warn("[Playlist Exporter] Playlist metadata failed:",error);}}}
  await Promise.all(Array.from({length:Math.min(concurrency,rootRows.length)},worker));
  return { playlists:playlists.filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"})) };
}

function parseDurationMilliseconds(value) {
  const numeric=numericValue(value); if(numeric!=null)return numeric;
  if(typeof value!=="string")return null; const text=value.trim(); if(!text)return null;
  if(/^\d+(?::\d{1,2}){1,2}$/.test(text)){const parts=text.split(":").map(Number);let seconds=0;for(const part of parts)seconds=seconds*60+part;return seconds*1000;}
  return null;
}
function trackUriFrom(value) {
  const candidates=[value?.uri,value?.link,value?.track?.uri,value?.track?.link,value?.item?.uri,value?.item?.link,value?.trackMetadata?.uri,value?.trackMetadata?.link,value?.metadata?.uri,value?.metadata?.link,value?.metadata?.entity_uri];
  for(const candidate of candidates) if(typeof candidate==="string"&&(candidate.startsWith("spotify:track:")||candidate.startsWith("spotify:local:")))return candidate;
  return "";
}
function artistNamesFrom(...values) {
  for(const value of values){if(!value)continue;const raw=Array.isArray(value)?value:[value];const names=raw.map((artist)=>typeof artist==="string"?artist:firstDefined(artist?.name,artist?.display_name,artist?.displayName,artist?.title,"")).filter(Boolean);if(names.length)return names;}
  return [];
}
function artistIdsFrom(...values) {
  for(const value of values){
    if(!value)continue;
    const raw=Array.isArray(value)?value:[value];
    const ids=raw.map((artist)=>{
      if(typeof artist==="string")return idFromUri(artist,"artist")||"";
      return firstDefined(artist?.id,idFromUri(artist?.uri||artist?.link,"artist"),"")||"";
    }).filter(Boolean);
    if(ids.length)return ids;
  }
  return [];
}
function normalizeAddedBy(value) {
  if(!value)return "";
  if(typeof value==="string")return value;
  return firstDefined(value?.display_name,value?.displayName,value?.name,value?.id,value?.username,idFromUri(value?.uri,"user"),"") || "";
}
function normalizeTrackRow(row,index=0) {
  if(!row)return null;
  const track=row?.item||row?.track||row?.trackMetadata||row;
  const uri=trackUriFrom(row)||trackUriFrom(track);
  if(!uri)return null;
  const metadata=track?.metadata||row?.metadata||{};
  const isLocal=Boolean(firstDefined(track?.isLocal,track?.is_local,row?.isLocal,row?.is_local,uri.startsWith("spotify:local:"),false));
  const artistSources=[track?.artists,row?.artists,track?.artist,row?.artist,metadata?.artists,metadata?.artist,metadata?.artist_name,metadata?.artistName,metadata?.["artist_name:1"]];
  const artists=artistNamesFrom(...artistSources);
  const artistIds=artistIdsFrom(...artistSources);
  const album=track?.album||row?.album||metadata?.album||{};
  const name=firstDefined(track?.name,track?.title,row?.name,row?.title,metadata?.title,metadata?.track_name,metadata?.name,"");
  const durationMs=parseDurationMilliseconds(firstDefined(track?.duration_ms,track?.duration,track?.durationMs,row?.duration_ms,row?.duration,row?.durationMs,metadata?.duration,metadata?.duration_ms));
  const id=firstDefined(track?.id,row?.id,idFromUri(uri,"track"));
  const externalUrls=track?.external_urls||row?.external_urls||{};
  const restriction=firstDefined(track?.restrictions?.reason,row?.restrictions?.reason,metadata?.restriction,metadata?.restrictions,"");
  return {
    uri,id,name:String(name||"").trim(),artists,artist_ids:artistIds,duration_ms:durationMs,
    album_name:firstDefined(album?.name,track?.album_name,row?.album_name,metadata?.album_name,metadata?.album_title,"") || "",
    album_type:firstDefined(album?.album_type,track?.album_type,row?.album_type,"") || "",
    album_id:firstDefined(album?.id,idFromUri(album?.uri,"album"),"") || "",
    album_image_url:firstDefined(pickAlbumImageUrl(album?.images),pickAlbumImageUrl(track?.album?.images),spotifyImageUrl(metadata?.album_image_url),spotifyImageUrl(metadata?.entity_pic_url),"") || "",
    release_date:firstDefined(album?.release_date,track?.release_date,row?.release_date,metadata?.release_date,"") || "",
    release_date_precision:firstDefined(album?.release_date_precision,track?.release_date_precision,row?.release_date_precision,"") || "",
    track_number:numericValue(track?.track_number,row?.track_number,metadata?.track_number),
    disc_number:numericValue(track?.disc_number,row?.disc_number,metadata?.disc_number),
    explicit:firstDefined(track?.explicit,row?.explicit,metadata?.explicit,null),
    isrc:firstDefined(track?.external_ids?.isrc,row?.external_ids?.isrc,metadata?.isrc,"") || "",
    spotify_url:firstDefined(externalUrls?.spotify,track?.externalUrl,row?.externalUrl,id?`https://open.spotify.com/track/${id}`:"") || "",
    playlist_position:index+1,
    added_at:firstDefined(row?.added_at,row?.addedAt,row?.addTime,row?.added_time,row?.metadata?.added_at,"") || "",
    added_by:normalizeAddedBy(firstDefined(row?.added_by,row?.addedBy,row?.creator,row?.added_by_user,null)),
    is_local:isLocal,
    is_playable:firstDefined(track?.is_playable,row?.is_playable,metadata?.is_playable,null),
    restriction:typeof restriction==="string"?restriction:""
  };
}

function mergeTrackDetail(base,data) {
  if(!data)return base;
  const album=data.album||{};
  return {
    ...base,
    uri:data.uri||base.uri,
    id:data.id||base.id,
    name:data.name||base.name,
    artists:Array.isArray(data.artists)&&data.artists.length?data.artists.map((a)=>a?.name).filter(Boolean):base.artists,
    artist_ids:Array.isArray(data.artists)&&data.artists.length?data.artists.map((a)=>a?.id||idFromUri(a?.uri,"artist")).filter(Boolean):(base.artist_ids||[]),
    duration_ms:data.duration_ms??base.duration_ms,
    album_name:album.name||base.album_name,
    album_type:album.album_type||base.album_type,
    album_id:album.id||base.album_id,
    album_image_url:pickAlbumImageUrl(album.images)||base.album_image_url||"",
    release_date:album.release_date||base.release_date,
    release_date_precision:album.release_date_precision||base.release_date_precision,
    track_number:data.track_number??base.track_number,
    disc_number:data.disc_number??base.disc_number,
    explicit:data.explicit??base.explicit,
    isrc:data.external_ids?.isrc||base.isrc,
    spotify_url:data.external_urls?.spotify||base.spotify_url,
    is_playable:data.is_playable??base.is_playable,
    restriction:data.restrictions?.reason||base.restriction
  };
}

async function fetchTrackDetailsBatch(tracks,warnings) {
  const byId=new Map();
  tracks.forEach((track,index)=>{if(track.id&&!track.is_local){if(!byId.has(track.id))byId.set(track.id,[]);byId.get(track.id).push(index);}});
  const ids=Array.from(byId.keys());
  for(let offset=0;offset<ids.length;offset+=50){
    const chunk=ids.slice(offset,offset+50);
    try{
      const data=await cosmosGet(`https://api.spotify.com/v1/tracks?ids=${encodeURIComponent(chunk.join(","))}`);
      const details=Array.isArray(data?.tracks)?data.tracks:[];
      details.forEach((detail,i)=>{const id=chunk[i];if(!detail||!byId.has(id))return;for(const index of byId.get(id))tracks[index]=mergeTrackDetail(tracks[index],detail);});
    }catch(error){
      warnings.push(`Could not batch-load complete metadata for ${chunk.length} tracks: ${error?.message||"request failed"}.`);
      for(const id of chunk){
        try{const detail=await cosmosGet(`https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`);for(const index of byId.get(id)||[])tracks[index]=mergeTrackDetail(tracks[index],detail);}catch{}
      }
    }
  }
  return tracks;
}

async function fetchArtistGenres(tracks,warnings) {
  const ids=Array.from(new Set((tracks||[]).flatMap((track)=>track.artist_ids||[]).filter(Boolean)));
  if(!ids.length){warnings.push("Genres were requested, but Spotify did not expose artist IDs for these tracks.");return tracks;}
  let cursor=0,failed=0;
  const failedIds=new Set();
  async function worker(){
    while(cursor<ids.length){
      const id=ids[cursor++];
      if(ARTIST_GENRE_CACHE.has(id))continue;
      try{
        const artist=await cosmosGet(`https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`);
        ARTIST_GENRE_CACHE.set(id,Array.isArray(artist?.genres)?artist.genres.filter(Boolean):[]);
      }catch{failed++;failedIds.add(id);}
    }
  }
  await Promise.all(Array.from({length:Math.min(5,ids.length)},worker));
  for(const track of tracks){
    const seen=new Set(),genres=[];
    for(const id of track.artist_ids||[]){
      if(failedIds.has(id))continue;
      for(const genre of ARTIST_GENRE_CACHE.get(id)||[]){const key=String(genre).toLowerCase();if(!seen.has(key)){seen.add(key);genres.push(genre);}}
    }
    track.genres=genres;
  }
  if(failed)warnings.push(`Genres could not be loaded for ${failed} artist${failed===1?"":"s"}; those cells were left blank.`);
  return tracks;
}

async function fetchTrackAudioAnalysis(tracks,warnings) {
  if(typeof Spicetify.getAudioData!=="function"){warnings.push("Audio analysis is unavailable in this Spicetify build; requested audio-analysis cells were left blank.");return tracks;}
  const targets=(tracks||[]).filter((track)=>!track.is_local&&typeof track.uri==="string"&&track.uri.startsWith("spotify:track:"));
  let cursor=0,failed=0;
  async function worker(){
    while(cursor<targets.length){
      const track=targets[cursor++];
      try{
        let analysis=AUDIO_ANALYSIS_CACHE.get(track.uri);
        if(!analysis){
          const data=await Spicetify.getAudioData(track.uri);
          analysis=data?.track||data;
          if(analysis&&typeof analysis==="object")AUDIO_ANALYSIS_CACHE.set(track.uri,analysis);
        }
        if(!analysis||typeof analysis!=="object"){failed++;continue;}
        track.audio_key=numericValue(analysis.key);
        track.loudness=numericValue(analysis.loudness);
        track.mode=numericValue(analysis.mode);
        track.tempo=numericValue(analysis.tempo);
        track.time_signature=numericValue(analysis.time_signature);
      }catch{failed++;}
    }
  }
  await Promise.all(Array.from({length:Math.min(4,targets.length)},worker));
  if(failed)warnings.push(`Audio analysis was unavailable for ${failed} track${failed===1?"":"s"}; those cells were left blank.`);
  return tracks;
}

async function enrichRequestedMetadata(tracks,profile,warnings) {
  const tasks=[];
  if(profile?.columns?.includes("genres"))tasks.push(fetchArtistGenres(tracks,warnings));
  if(profile?.columns?.some((id)=>AUDIO_ANALYSIS_COLUMN_IDS.has(id)))tasks.push(fetchTrackAudioAnalysis(tracks,warnings));
  if(tasks.length)await Promise.all(tasks);
  return tracks;
}

async function prepareTracksForExport(tracks,profile,warnings) {
  await fetchTrackDetailsBatch(tracks,warnings);
  await enrichRequestedMetadata(tracks,profile,warnings);
  return tracks;
}

async function fetchPlaylistTracksPlatform(uri) {
  const api=Spicetify.Platform?.PlaylistAPI; if(!api?.getPlaylist)return null;
  const playlist=await api.getPlaylist(uri); const items=playlist?.contents?.items||playlist?.items||playlist?.tracks?.items;
  if(!Array.isArray(items))return null; return items.map((row,index)=>normalizeTrackRow(row,index)).filter(Boolean);
}
async function fetchPlaylistTracksInternal(uri) {
  const endpoints=[`sp://core-playlist/v1/playlist/${uri}/rows`,`sp://core-playlist/v1/playlist/${uri}`]; let lastError=null;
  for(const endpoint of endpoints){try{const data=await cosmosGet(endpoint);const rows=data?.rows||data?.items||data?.contents?.items||data?.playlist?.rows;if(!Array.isArray(rows))continue;const tracks=rows.map((row,index)=>normalizeTrackRow(row,index)).filter(Boolean);if(tracks.length)return tracks;}catch(error){lastError=error;}}
  if(lastError)throw lastError; return [];
}
async function fetchPlaylistTracksWebApi(playlistId) {
  const tracks=[];let offset=0;const limit=50;
  while(true){const data=await cosmosGet(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=${offset}`);const items=Array.isArray(data?.items)?data.items:[];items.forEach((item,i)=>{const t=normalizeTrackRow(item,offset+i);if(t)tracks.push(t);});if(!data?.next||items.length===0)break;offset+=items.length;}
  return tracks;
}

function adapterDedupe(tracks) {
  // Preserve intentional duplicate playlist entries. We only remove adapter-level duplicate objects when the same position + URI appears twice.
  const out=[];const seen=new Set();
  for(const t of tracks||[]){const key=`${t.playlist_position}|${t.uri}`;if(seen.has(key))continue;seen.add(key);out.push(t);}return out;
}

async function fetchPlaylistTracks(playlist,profile) {
  const attempts=[],candidates=[],warnings=[];const expected=Number.isFinite(playlist.trackCount)?playlist.trackCount:null;
  const record=(source,list)=>{const tracks=Array.isArray(list)?list:[];attempts.push(`${source}: ${tracks.length}`);if(tracks.length)candidates.push({source,tracks});return expected!=null&&expected>0&&tracks.length>=expected;};
  try{const t=await fetchPlaylistTracksInternal(playlist.uri);if(record("core-playlist rows",t)){let tracks=adapterDedupe(t);await prepareTracksForExport(tracks,profile,warnings);return finalizeFetchedTracks(tracks,playlist,profile,warnings,"core-playlist rows",expected);}}catch(error){attempts.push(`core-playlist rows: ${error?.message||"failed"}`);}
  try{const t=await fetchPlaylistTracksPlatform(playlist.uri);if(t==null)attempts.push("Spotify desktop API: unavailable");else if(record("Spotify desktop API",t)){let tracks=adapterDedupe(t);await prepareTracksForExport(tracks,profile,warnings);return finalizeFetchedTracks(tracks,playlist,profile,warnings,"Spotify desktop API",expected);}}catch(error){attempts.push(`Spotify desktop API: ${error?.message||"failed"}`);}
  try{const t=await fetchPlaylistTracksWebApi(playlist.id);if(record("Web API",t)){let tracks=adapterDedupe(t);await prepareTracksForExport(tracks,profile,warnings);return finalizeFetchedTracks(tracks,playlist,profile,warnings,"Web API",expected);}}catch(error){attempts.push(`Web API: ${error?.message||"failed"}`);}
  if(candidates.length){candidates.sort((a,b)=>b.tracks.length-a.tracks.length);const best=candidates[0];let tracks=adapterDedupe(best.tracks);await prepareTracksForExport(tracks,profile,warnings);return finalizeFetchedTracks(tracks,playlist,profile,warnings,best.source,expected);}
  throw new Error(`Spotify returned no readable tracks for "${playlist.name}". ${attempts.join("; ")}`);
}

function finalizeFetchedTracks(tracks,playlist,profile,warnings,source,expected) {
  if(expected!=null&&expected>tracks.length)warnings.push(`Spotify reports about ${expected} playlist items, but the best readable source returned ${tracks.length}.`);
  const localCount=tracks.filter((t)=>t.is_local).length; if(localCount)warnings.push(`${localCount} local track${localCount===1?" has":"s have"} limited Spotify metadata.`);
  const missingName=tracks.filter((t)=>!t.name).length; if(missingName)warnings.push(`${missingName} track${missingName===1?" is":"s are"} missing a track name.`);
  const missingArtists=tracks.filter((t)=>!t.artists?.length).length; if(missingArtists)warnings.push(`${missingArtists} track${missingArtists===1?" is":"s are"} missing artist metadata.`);
  return { tracks, warnings, source, expected };
}

function formatTrackDuration(ms) {
  if(!Number.isFinite(ms)||ms<0)return "";const total=Math.round(ms/1000),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
  return hours>0?`${hours}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`:`${minutes}:${String(seconds).padStart(2,"0")}`;
}
function csvEscape(value) { const text=value==null?"":String(value); return `"${text.replace(/"/g,'""')}"`; }
function getSortValue(track,field) {
  switch(field){case"primary_artist":return track.artists?.[0]||"";case"track_name":return track.name||"";case"album_name":return track.album_name||"";case"release_date":return track.release_date||"";case"duration":return track.duration_ms??-1;case"playlist_position":return track.playlist_position??0;case"date_added":return track.added_at||"";default:return"";}
}
function compareValue(a,b,collator){if(typeof a==="number"&&typeof b==="number")return a-b;return collator.compare(String(a??""),String(b??""));}
function sortTracks(tracks,profile) {
  const collator=new Intl.Collator(undefined,{sensitivity:"base",numeric:true});
  return [...tracks].sort((a,b)=>{
    let result=profile.sortPrimary==="none"?0:compareValue(getSortValue(a,profile.sortPrimary),getSortValue(b,profile.sortPrimary),collator)*(profile.sortPrimaryDirection==="desc"?-1:1);
    if(!result&&profile.sortSecondary!=="none")result=compareValue(getSortValue(a,profile.sortSecondary),getSortValue(b,profile.sortSecondary),collator)*(profile.sortSecondaryDirection==="desc"?-1:1);
    if(!result)result=(a.playlist_position??0)-(b.playlist_position??0);
    return result;
  });
}
function removeConfiguredDuplicates(tracks,mode) {
  if(mode==="keep")return{tracks:[...tracks],removed:0};
  const seen=new Set(),out=[];let removed=0;
  for(const track of tracks){
    let key="";
    if(mode==="exact")key=track.id?`id:${track.id}`:(track.uri?`uri:${track.uri}`:"");
    else if(mode==="recording")key=track.isrc?`isrc:${String(track.isrc).toUpperCase()}`:(track.id?`id:${track.id}`:(track.uri?`uri:${track.uri}`:""));
    if(key&&seen.has(key)){removed++;continue;}if(key)seen.add(key);out.push(track);
  }
  return{tracks:out,removed};
}
function buildPlaylistCSV(tracks,profile) {
  const columns=profile.columns.map((id)=>COLUMN_MAP[id]).filter(Boolean);
  const rows=[columns.map((c)=>c.label),...sortTracks(tracks,profile).map((track)=>columns.map((c)=>c.value(track)))];
  return "\uFEFF"+rows.map((row)=>row.map(csvEscape).join(",")).join("\r\n")+"\r\n";
}
function sanitizeFilename(value) { return String(value||"playlist").replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").replace(/\s+/g," ").trim().replace(/[. ]+$/g,"")||"playlist"; }
function formatDateToken(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
function formatTimeToken(date=new Date()){return `${String(date.getHours()).padStart(2,"0")}-${String(date.getMinutes()).padStart(2,"0")}-${String(date.getSeconds()).padStart(2,"0")}`;}
function renderFilenameTemplate(template,playlist,date=new Date()) {
  const safeTemplate=String(template||"{playlist_name}.csv");
  let output=safeTemplate
    .replaceAll("{playlist_name}",playlist.name||"playlist")
    .replaceAll("{playlist_id}",playlist.id||"")
    .replaceAll("{owner}",playlist.ownerName||"")
    .replaceAll("{date}",formatDateToken(date))
    .replaceAll("{time}",formatTimeToken(date))
    .replaceAll("{timestamp}",`${formatDateToken(date)}_${formatTimeToken(date)}`);
  output=sanitizeFilename(output);
  if(!/\.csv$/i.test(output))output+=".csv";
  return output;
}
function addSuffixBeforeExtension(filename,suffix){return filename.replace(/(\.csv)$/i,`${suffix}$1`);}
function triggerBrowserDownload(content,filename) {
  const blob=new Blob([content],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function directoryFileExists(handle,filename){try{await handle.getFileHandle(filename,{create:false});return true;}catch(error){if(error?.name==="NotFoundError")return false;throw error;}}
async function resolveDirectoryFilename(handle,filename,behavior,date) {
  let candidate=filename;
  if(behavior==="timestamp")candidate=addSuffixBeforeExtension(filename,`_${formatDateToken(date)}_${formatTimeToken(date)}`);
  if(behavior==="replace")return filename;
  if(!(await directoryFileExists(handle,candidate)))return candidate;
  for(let i=2;i<10000;i++){const numbered=addSuffixBeforeExtension(candidate,` (${i})`);if(!(await directoryFileExists(handle,numbered)))return numbered;}
  return addSuffixBeforeExtension(candidate,`_${Date.now()}`);
}
async function writeCSVToDirectory(handle,filename,csv) { const fileHandle=await handle.getFileHandle(filename,{create:true});const writable=await fileHandle.createWritable();try{await writable.write(new Blob([csv],{type:"text/csv;charset=utf-8"}));}finally{await writable.close();} }
async function saveCSVForProfile(csv,baseFilename,profile,playlistId,allowPermissionPrompt,date,warnings) {
  if(profile.exportDestination==="folder"){
    const handle=await loadDirectoryHandleForPlaylist(playlistId);if(!handle)throw new Error("The configured custom folder is not connected. Open Playlist Exporter and choose the folder again.");
    const allowed=await ensureDirectoryPermission(handle,allowPermissionPrompt);if(!allowed)throw new Error("Spotify does not currently have write permission for the configured folder. Open Playlist Exporter and reconnect it with a manual export.");
    const filename=await resolveDirectoryFilename(handle,baseFilename,profile.overwriteBehavior,date);await writeCSVToDirectory(handle,filename,csv);return{filename,destination:profile.downloadFolderName||handle.name||"Custom folder"};
  }
  let filename=baseFilename;
  if(profile.overwriteBehavior==="timestamp")filename=addSuffixBeforeExtension(filename,`_${formatDateToken(date)}_${formatTimeToken(date)}`);
  if(profile.overwriteBehavior==="replace")warnings.push("Standard Downloads cannot force-overwrite an existing file; Spotify/Chromium may automatically rename a duplicate filename.");
  if(profile.overwriteBehavior==="increment")warnings.push("Standard Downloads uses Spotify/Chromium's own numbered-copy behavior because the app cannot inspect the Downloads directory.");
  triggerBrowserDownload(csv,filename);return{filename,destination:"Downloads"};
}

function applyPresetToProfile(profile,preset) { return normalizeProfile({ ...profile, ...clone(preset.settings), presetId:preset.id }); }
function getAllPresets(config){return [...BUILTIN_PRESETS,...(config.customPresets||[]).map((p)=>({...p,builtin:false}))];}
function exportSettingsFromProfile(profile){const {columns,sortPrimary,sortPrimaryDirection,sortSecondary,sortSecondaryDirection,filenameTemplate,overwriteBehavior,duplicateMode}=profile;return{columns:[...columns],sortPrimary,sortPrimaryDirection,sortSecondary,sortSecondaryDirection,filenameTemplate,overwriteBehavior,duplicateMode};}

function formatDateTime(timestamp){if(!timestamp)return"Never";try{return new Date(timestamp).toLocaleString([],{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"});}catch{return"Never";}}
function formatInterval(hours){const n=Number(hours);if(n===0.5)return"30 min";if(n===1)return"1 hour";return`${n} hours`;}
function nextExportText(profile){if(!profile.autoEnabled)return"Manual only";const base=profile.lastAttemptTime||profile.autoEnabledSince||Date.now();const due=base+profile.exportIntervalHours*3600000;const diff=due-Date.now();if(diff<=0)return"Due now";const minutes=Math.ceil(diff/60000);if(minutes<60)return`in ${minutes} min`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`in ${hours}h ${rest}m`:`in ${hours}h`;}

function buildSummaryPopupElement(summary) {
  const root=document.createElement("div");root.style.cssText="min-width:420px;max-width:720px;color:var(--spice-text);font-family:inherit";
  const top=document.createElement("div");top.style.cssText="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px";
  const metrics=[["Playlists",summary.results.length],["Tracks",summary.results.reduce((s,r)=>s+(r.exportedTracks||0),0)],["Covers",summary.results.reduce((s,r)=>s+(r.coversSaved||0),0)],["Warnings",summary.results.reduce((s,r)=>s+(r.warnings?.length||0),0)]];
  metrics.forEach(([label,value])=>{const card=document.createElement("div");card.style.cssText="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.04)";const l=document.createElement("div");l.textContent=label;l.style.cssText="font-size:11px;color:var(--spice-subtext)";const v=document.createElement("div");v.textContent=String(value);v.style.cssText="font-size:20px;font-weight:750;margin-top:4px";card.append(l,v);top.append(card);});
  root.append(top);
  for(const result of summary.results){const item=document.createElement("div");item.style.cssText="padding:11px 0;border-top:1px solid rgba(255,255,255,.1)";const title=document.createElement("div");title.style.cssText="display:flex;justify-content:space-between;gap:12px;font-weight:700;font-size:13px";const name=document.createElement("span");name.textContent=result.playlistName;const status=document.createElement("span");status.textContent=result.ok?`${result.exportedTracks} tracks`:`Failed`;status.style.color=result.ok?"var(--spice-button)":"#ff8585";title.append(name,status);item.append(title);
    const detail=document.createElement("div");detail.style.cssText="margin-top:4px;color:var(--spice-subtext);font-size:11.5px;line-height:1.45";detail.textContent=result.ok?`${result.filename} → ${result.destination}${result.duplicatesRemoved?` · ${result.duplicatesRemoved} duplicates removed`:""}${result.coversSaved?` · ${result.coversSaved} cover image${result.coversSaved===1?"":"s"}${result.coversFailed?`, ${result.coversFailed} failed`:""}`:""}`:(result.error||"Unknown export error");item.append(detail);
    if(result.warnings?.length){const list=document.createElement("ul");list.style.cssText="margin:7px 0 0 18px;padding:0;color:var(--spice-subtext);font-size:11px;line-height:1.45";result.warnings.slice(0,8).forEach((warning)=>{const li=document.createElement("li");li.textContent=warning;list.append(li);});if(result.warnings.length>8){const li=document.createElement("li");li.textContent=`${result.warnings.length-8} more warning(s)`;list.append(li);}item.append(list);}root.append(item);
  }
  const footer=document.createElement("div");footer.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)";const stamp=document.createElement("div");stamp.textContent=`${summary.reason==="automatic"?"Automatic":"Manual"} export · ${new Date(summary.completedAt).toLocaleString()}`;stamp.style.cssText="font-size:11px;color:var(--spice-subtext)";const close=document.createElement("button");close.textContent="Close";close.style.cssText="border:0;border-radius:999px;padding:8px 16px;background:var(--spice-button);color:#000;font-weight:700;cursor:pointer";close.addEventListener("click",()=>Spicetify.PopupModal?.hide?.());footer.append(stamp,close);root.append(footer);return root;
}
function showPersistentSummary(summary) {
  try { Spicetify.PopupModal.display({ title:summary.reason==="automatic"?"Automatic playlist export complete":"Playlist export summary", content:buildSummaryPopupElement(summary), isLarge:true }); }
  catch(error){console.warn("[Playlist Exporter] Summary popup failed:",error);Spicetify.showNotification?.(`Playlist export finished: ${summary.results.filter((r)=>r.ok).length}/${summary.results.length} successful.`,summary.results.some((r)=>!r.ok),10000);}
}

function coverBaseName(track) { return sanitizeFilename(`${track.artists?.[0]||"Unknown artist"} - ${track.album_name||"Unknown album"}`).replace(/\.jpg$/i,"")||"cover"; }
function collectCoverJobs(tracks) {
  const jobs=[],byKey=new Map(),usedNames=new Map();
  for(const track of tracks){
    if(track.is_local)continue;
    const url=track.album_image_url;
    if(!url)continue;
    const key=track.album_id||url;
    const existing=byKey.get(key);
    if(existing){existing.tracks+=1;continue;}
    let name=`${coverBaseName(track)}.jpg`;
    const count=(usedNames.get(name)||0)+1;usedNames.set(name,count);
    if(count>1)name=name.replace(/(\.jpg)$/i,` (${count})$1`);
    const job={key,url,name,tracks:1};
    byKey.set(key,job);jobs.push(job);
  }
  return jobs;
}
async function fetchImageBlob(url) {
  let response;
  try{response=await fetch(url,{mode:"cors",credentials:"omit"});}
  catch(error){throw new Error(`network error: ${error?.message||"fetch failed"}`);}
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob();
  if(!blob.size)throw new Error("empty image");
  return blob;
}
async function writeBlobToDirectory(dirHandle,filename,blob) {
  const fileHandle=await dirHandle.getFileHandle(filename,{create:true});
  const writable=await fileHandle.createWritable();
  try{await writable.write(blob);}finally{await writable.close();}
}
function triggerImageDownload(blob,filename) {
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function saveCoversForPlaylist(tracks,playlistId,profile,allowPermissionPrompt,warnings,onCoverProgress=null) {
  const jobs=collectCoverJobs(tracks);
  const missingArt=tracks.filter((track)=>!track.is_local&&!track.album_image_url).length;
  if(missingArt)warnings.push(`${missingArt} track${missingArt===1?" has no cover art":"s have no cover art"}; those covers were skipped.`);
  if(!jobs.length)return{saved:0,failed:0};
  let saved=0,failed=0,index=0;
  const fail=(job,error)=>{failed++;console.warn(`[Playlist Exporter] Cover art failed for "${job.name}":`,error);};
  if(profile.exportDestination==="folder"){
    const handle=await loadDirectoryHandleForPlaylist(playlistId);
    if(!handle)throw new Error("the configured custom folder is not connected, so cover images could not be saved");
    const allowed=await ensureDirectoryPermission(handle,allowPermissionPrompt);
    if(!allowed)throw new Error("Spotify does not currently have write permission for the configured folder, so cover images could not be saved");
    const coversDir=await handle.getDirectoryHandle(COVER_SUBFOLDER_NAME,{create:true});
    for(const job of jobs){
      index++;
      try{
        if(onCoverProgress)onCoverProgress(`Downloading cover art ${index}/${jobs.length}`);
        const blob=await fetchImageBlob(job.url);
        await writeBlobToDirectory(coversDir,job.name,blob);
        saved++;
      }catch(error){fail(job,error);}
    }
  }else{
    warnings.push(`Cover images are downloaded individually into Downloads. If Spotify/Chromium asks to allow multiple downloads, choose Allow. Use a custom folder destination to write them into one “${COVER_SUBFOLDER_NAME}” subfolder instead.`);
    for(const job of jobs){
      index++;
      try{
        if(onCoverProgress)onCoverProgress(`Downloading cover art ${index}/${jobs.length}`);
        const blob=await fetchImageBlob(job.url);
        triggerImageDownload(blob,job.name);
        saved++;
      }catch(error){fail(job,error);}
    }
  }
  if(failed)warnings.push(`${failed} of ${jobs.length} cover image${jobs.length===1?"":"s"} could not be downloaded.`);
  return{saved,failed};
}

async function exportSingleFreshPlaylist(playlist,profile,allowPermissionPrompt,onCoverProgress=null) {
  const date=new Date(),warnings=[];
  const fetched=await fetchPlaylistTracks(playlist,profile);warnings.push(...fetched.warnings);
  const deduped=removeConfiguredDuplicates(fetched.tracks,profile.duplicateMode);
  if(deduped.removed)warnings.push(`${deduped.removed} duplicate playlist entr${deduped.removed===1?"y was":"ies were"} removed using ${profile.duplicateMode==="recording"?"ISRC/Spotify ID":"Spotify track ID"}; track title alone is never used for duplicate detection.`);
  for (const columnId of profile.columns) {
    const column=COLUMN_MAP[columnId];
    if(!column)continue;
    const missing=deduped.tracks.filter((track)=>{const value=column.value(track);return value===""||value==null;}).length;
    if(missing>0)warnings.push(`${missing} of ${deduped.tracks.length} exported tracks have no value for “${column.label}”; those CSV cells were left blank.`);
  }
  const csv=buildPlaylistCSV(deduped.tracks,profile);
  const baseFilename=renderFilenameTemplate(profile.filenameTemplate,playlist,date);
  const saved=await saveCSVForProfile(csv,baseFilename,profile,playlist.id,allowPermissionPrompt,date,warnings);
  let covers={saved:0,failed:0};
  if(profile.downloadCovers){
    try{covers=await saveCoversForPlaylist(deduped.tracks,playlist.id,profile,allowPermissionPrompt,warnings,onCoverProgress);}
    catch(error){warnings.push(error?.message||String(error));}
  }
  return { ok:true,playlistId:playlist.id,playlistName:playlist.name,source:fetched.source,originalTracks:fetched.tracks.length,exportedTracks:deduped.tracks.length,duplicatesRemoved:deduped.removed,filename:saved.filename,destination:saved.destination,coversSaved:covers.saved,coversFailed:covers.failed,warnings };
}

let exportBatchRunning=false;

async function runExportBatch(playlistIds,reason="manual",allowPermissionPrompt=false,onProgress=null) {
  const ids=Array.from(new Set(playlistIds||[]));
  const summary={reason,startedAt:Date.now(),completedAt:null,results:[]};
  if(!ids.length)return summary;
  if(exportBatchRunning)throw new Error("Another Playlist Exporter batch is already running. Try again after it finishes.");

  exportBatchRunning=true;
  try {
    if(onProgress)onProgress({current:0,total:ids.length,label:"Refreshing Spotify library before export"});
    let library={playlists:[]};
    let libraryError=null;
    try{library=await fetchLibraryPlaylists();}
    catch(error){libraryError=error;}

    const config=loadConfig();
    for(let i=0;i<ids.length;i++){
      const id=ids[i];
      const profile=getProfile(config,id);
      const playlist=library.playlists.find((p)=>p.id===id);
      if(onProgress)onProgress({current:i,total:ids.length,label:playlist?`Reading latest version of ${playlist.name}`:`Finding playlist ${id}`});

      let result;
      if(!playlist){
        result={
          ok:false,
          playlistId:id,
          playlistName:`Playlist ${id}`,
          exportedTracks:0,
          warnings:[],
          error:libraryError
            ? `Could not refresh the Spotify library before export: ${libraryError?.message||String(libraryError)}`
            : "The playlist was not found in the refreshed Spotify library. It may have been removed from Your Library."
        };
      } else {
        try{
          result=await exportSingleFreshPlaylist(playlist,profile,allowPermissionPrompt,onProgress?(label)=>onProgress({current:i,total:ids.length,label}):null);
        } catch(error){
          result={ok:false,playlistId:id,playlistName:playlist.name,exportedTracks:0,warnings:[],error:error?.message||String(error)};
        }
      }

      summary.results.push(result);
      const now=Date.now();
      const latest=loadConfig();
      const updated=withProfile(latest,id,(previous)=>({ ...previous,lastAttemptTime:now,lastExportTime:result.ok?now:previous.lastExportTime,exportCount:(previous.exportCount||0)+(result.ok?1:0) }));
      updated.lastAnyExportTime=result.ok?now:updated.lastAnyExportTime;
      updated.totalExportedFiles=(updated.totalExportedFiles||0)+(result.ok?1:0);
      saveConfig(updated);
      if(onProgress)onProgress({current:i+1,total:ids.length,label:result.ok?`${result.playlistName}: ${result.exportedTracks} tracks exported`:`${result.playlistName}: export failed`});
    }

    summary.completedAt=Date.now();
    showPersistentSummary(summary);
    try{window.dispatchEvent(new CustomEvent("playlist-exporter-v4-export-complete",{detail:summary}));}catch{}
    return summary;
  } finally {
    exportBatchRunning=false;
  }
}

function schedulerIsDue(profile,now) {
  if(!profile.autoEnabled||!Number.isFinite(Number(profile.exportIntervalHours))||Number(profile.exportIntervalHours)<=0)return false;
  const base=profile.lastAttemptTime||profile.autoEnabledSince||now;
  return now-base>=Number(profile.exportIntervalHours)*3600000;
}
function startGlobalScheduler() {
  if(window.__playlistExporterV4Scheduler)return;
  const state={busy:false,timer:null};window.__playlistExporterV4Scheduler=state;
  const tick=async()=>{if(state.busy||exportBatchRunning)return;const config=loadConfig();const now=Date.now();const due=Object.entries(config.playlistProfiles||{}).filter(([,profile])=>schedulerIsDue(normalizeProfile(profile),now)).map(([id])=>id);if(!due.length)return;state.busy=true;try{await runExportBatch(due,"automatic",false,null);}catch(error){console.error("[Playlist Exporter] Automatic export batch failed:",error);}finally{state.busy=false;}};
  state.timer=setInterval(tick,SCHEDULER_TICK_MS);setTimeout(tick,2500);
}

function StatusPill({status}) { const labels={idle:"Ready",loading:"Refreshing",exporting:"Exporting",done:"Complete",error:"Attention"};return h("div",{className:"pe4-status","data-state":status},h("span",{className:"pe4-status-dot"}),labels[status]||"Ready"); }
function StatCard({label,value}) { return h("div",{className:"pe4-stat"},h("div",{className:"pe4-stat-label"},label),h("div",{className:"pe4-stat-value",title:String(value)},value)); }
function PlaylistCover({playlist,className="pe4-cover"}) { return playlist.image?h("img",{className,src:playlist.image,alt:""}):h("div",{className:`${className} pe4-cover-fallback`},h(Icon,{name:"playlist",size:20})); }

function PlaylistExporterApp() {
  const [playlists,setPlaylists]=useState([]);
  const [config,setConfig]=useState(loadConfig);
  const [status,setStatus]=useState("loading");
  const [message,setMessage]=useState("");
  const [messageKind,setMessageKind]=useState("info");
  const [search,setSearch]=useState("");
  const [activePlaylistId,setActivePlaylistId]=useState(null);
  const [progress,setProgress]=useState({current:0,total:0,label:""});
  const [presetName,setPresetName]=useState("");
  const [folderPermissions,setFolderPermissions]=useState({});
  const refreshTimerRef=useRef(null);
  const folderPickerSupported=typeof window.showDirectoryPicker==="function";

  const updateConfig=useCallback((updater)=>{setConfig(()=>{const latest=loadConfig();const next=typeof updater==="function"?updater(latest):updater;saveConfig(next);return next;});},[]);
  const updateProfile=useCallback((playlistId,updater)=>{updateConfig((previous)=>withProfile(previous,playlistId,updater));},[updateConfig]);

  const refreshLibrary=useCallback(async(silent=false)=>{
    if(!silent)setStatus("loading");
    try{
      const result=await fetchLibraryPlaylists();setPlaylists(result.playlists);
      if(!activePlaylistId&&result.playlists.length)setActivePlaylistId(result.playlists[0].id);
      if(!silent){setStatus("idle");setMessage(result.playlists.length?"":"Spotify returned an empty library rootlist. Open Your Library in Spotify and refresh again.");setMessageKind(result.playlists.length?"info":"error");}
    }catch(error){if(!silent){setStatus("error");setMessage(`Could not refresh your Spotify library: ${error?.message||String(error)}`);setMessageKind("error");}}
  },[activePlaylistId]);

  useEffect(()=>{refreshLibrary(false);tryMigrateLegacyFolderHandles(loadConfig()).catch((error)=>console.warn("[Playlist Exporter] Legacy folder-handle migration failed:",error));},[]);
  useEffect(()=>{if(refreshTimerRef.current)clearInterval(refreshTimerRef.current);refreshTimerRef.current=setInterval(()=>refreshLibrary(true),LIBRARY_REFRESH_MS);return()=>clearInterval(refreshTimerRef.current);},[refreshLibrary]);
  useEffect(()=>{const handler=()=>{const latest=loadConfig();setConfig(latest);refreshLibrary(true);setStatus("done");setTimeout(()=>setStatus("idle"),2500);};window.addEventListener("playlist-exporter-v4-export-complete",handler);return()=>window.removeEventListener("playlist-exporter-v4-export-complete",handler);},[refreshLibrary]);

  const filteredPlaylists=useMemo(()=>{const q=search.trim().toLowerCase();return q?playlists.filter((p)=>`${p.name} ${p.ownerName}`.toLowerCase().includes(q)):playlists;},[playlists,search]);
  const activePlaylist=playlists.find((p)=>p.id===activePlaylistId)||filteredPlaylists[0]||null;
  const activeProfile=activePlaylist?getProfile(config,activePlaylist.id):null;
  const allPresets=getAllPresets(config);
  const selectedCount=config.selectedPlaylistIds.length;
  const autoCount=Object.values(config.playlistProfiles||{}).filter((p)=>normalizeProfile(p).autoEnabled).length;
  const busy=status==="loading"||status==="exporting";
  const progressPercent=progress.total?Math.round(progress.current/progress.total*100):0;

  const setSelected=(id,selected)=>updateConfig((previous)=>({...previous,selectedPlaylistIds:selected?Array.from(new Set([...previous.selectedPlaylistIds,id])):previous.selectedPlaylistIds.filter((x)=>x!==id)}));
  const selectVisible=()=>updateConfig((previous)=>({...previous,selectedPlaylistIds:Array.from(new Set([...previous.selectedPlaylistIds,...filteredPlaylists.map((p)=>p.id)]))}));
  const clearSelection=()=>updateConfig((previous)=>({...previous,selectedPlaylistIds:[]}));

  const chooseFolder=async(playlistId)=>{
    if(!folderPickerSupported){setMessage("This Spotify build does not expose the folder picker. Use Standard Downloads instead.");setMessageKind("error");return;}
    try{const handle=await window.showDirectoryPicker({id:`pe-${playlistId.slice(0,20)}`,mode:"readwrite",startIn:"downloads"});await saveDirectoryHandleForPlaylist(playlistId,handle);const permission=await queryDirectoryPermission(handle);setFolderPermissions((p)=>({...p,[playlistId]:permission}));updateProfile(playlistId,(profile)=>({...profile,exportDestination:"folder",downloadFolderName:handle.name||"Selected folder"}));setMessage(`Folder connected for ${playlists.find((p)=>p.id===playlistId)?.name||"playlist"}: ${handle.name||"Selected folder"}.`);setMessageKind("success");}catch(error){if(error?.name!=="AbortError"){setMessage(`Could not select folder: ${error?.message||String(error)}`);setMessageKind("error");}}
  };
  const disconnectFolder=async(playlistId)=>{await clearDirectoryHandleForPlaylist(playlistId);setFolderPermissions((p)=>({...p,[playlistId]:"unknown"}));updateProfile(playlistId,(profile)=>({...profile,exportDestination:"downloads",downloadFolderName:""}));};

  useEffect(()=>{if(!activePlaylistId)return;loadDirectoryHandleForPlaylist(activePlaylistId).then(async(handle)=>{if(handle){const permission=await queryDirectoryPermission(handle);setFolderPermissions((p)=>({...p,[activePlaylistId]:permission}));}});},[activePlaylistId]);

  const handleManualExport=async(ids)=>{
    const targets=(ids||config.selectedPlaylistIds).filter(Boolean);if(!targets.length){setMessage("Select at least one playlist to export.");setMessageKind("error");return;}
    setStatus("exporting");setMessage("");setProgress({current:0,total:targets.length,label:"Refreshing Spotify library"});
    try{const summary=await runExportBatch(targets,"manual",true,setProgress);const failed=summary.results.filter((r)=>!r.ok).length;setConfig(loadConfig());setStatus(failed?"error":"done");setMessage(failed?`${summary.results.length-failed} exported, ${failed} failed. See the export summary popup for details.`:`${summary.results.length} playlist${summary.results.length===1?"":"s"} exported successfully.`);setMessageKind(failed?"error":"success");}catch(error){setStatus("error");setMessage(`Export failed: ${error?.message||String(error)}`);setMessageKind("error");}finally{setTimeout(()=>setStatus("idle"),4000);}
  };

  const applyPreset=(presetId)=>{if(!activePlaylist)return;const preset=allPresets.find((p)=>p.id===presetId);if(!preset)return;updateProfile(activePlaylist.id,(profile)=>applyPresetToProfile(profile,preset));};
  const savePreset=()=>{if(!activePlaylist||!presetName.trim())return;const name=presetName.trim();const preset={id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name,settings:exportSettingsFromProfile(activeProfile)};updateConfig((previous)=>({...previous,customPresets:[...(previous.customPresets||[]),preset]}));setPresetName("");setMessage(`Preset "${name}" saved.`);setMessageKind("success");};
  const deletePreset=()=>{if(!activeProfile?.presetId?.startsWith("custom-"))return;const preset=allPresets.find((p)=>p.id===activeProfile.presetId);updateConfig((previous)=>({...previous,customPresets:(previous.customPresets||[]).filter((p)=>p.id!==activeProfile.presetId)}));updateProfile(activePlaylist.id,(profile)=>({...profile,presetId:"builtin-default"}));setMessage(`Preset "${preset?.name||"Custom preset"}" deleted.`);setMessageKind("success");};

  const toggleColumn=(columnId,checked)=>{if(!activePlaylist)return;updateProfile(activePlaylist.id,(profile)=>{let columns=[...profile.columns];if(checked){if(!columns.includes(columnId))columns.push(columnId);}else{columns=columns.filter((id)=>id!==columnId);if(!columns.length)columns=["track_name"];}return{...profile,columns,presetId:"customized"};});};
  const moveColumn=(columnId,direction)=>{if(!activePlaylist)return;updateProfile(activePlaylist.id,(profile)=>{const columns=[...profile.columns];const i=columns.indexOf(columnId),j=i+direction;if(i<0||j<0||j>=columns.length)return profile;[columns[i],columns[j]]=[columns[j],columns[i]];return{...profile,columns,presetId:"customized"};});};
  const changeProfileField=(field,value)=>{if(activePlaylist)updateProfile(activePlaylist.id,(profile)=>({...profile,[field]:value,presetId:["exportDestination","downloadFolderName","autoEnabled","exportIntervalHours","autoEnabledSince","lastAttemptTime","lastExportTime","downloadCovers"].includes(field)?profile.presetId:"customized"}));};
  const toggleAuto=(checked)=>{if(!activePlaylist)return;updateProfile(activePlaylist.id,(profile)=>({...profile,autoEnabled:checked,autoEnabledSince:checked?(profile.autoEnabledSince||Date.now()):null,lastAttemptTime:checked?profile.lastAttemptTime:null}));};

  const enabledColumns=activeProfile?activeProfile.columns.map((id)=>COLUMN_MAP[id]).filter(Boolean):[];
  const availableColumns=activeProfile?COLUMN_DEFS.filter((column)=>!activeProfile.columns.includes(column.id)):[];
  const previewColumns=enabledColumns;
  const previewFilename=activePlaylist&&activeProfile?renderFilenameTemplate(activeProfile.filenameTemplate,activePlaylist,new Date()):"playlist.csv";
  const sample={name:"Example track",artists:["Example Artist","Featured Artist"],genres:["indie pop","electropop"],duration_ms:213000,album_name:"Example Album",album_type:"album",release_date:"2025-06-20",track_number:4,disc_number:1,explicit:false,isrc:"USABC2500123",id:"0abc123",uri:"spotify:track:0abc123",spotify_url:"https://open.spotify.com/track/0abc123",album_image_url:"https://i.scdn.co/image/ab6761630000-example-640",playlist_position:12,added_at:"2026-08-09T02:10:00Z",added_by:"username",is_local:false,is_playable:true,restriction:"",audio_key:9,loudness:-5.883,mode:1,tempo:118.211,time_signature:4};

  return h(React.Fragment,null,
    h("style",{dangerouslySetInnerHTML:{__html:APP_CSS}}),
    h("main",{className:"pe4-app"},
      h("header",{className:"pe4-header"},
        h("div",{className:"pe4-title-wrap"},h("div",{className:"pe4-logo"},h(Icon,{name:"download",size:22})),h("div",null,h("h1",{className:"pe4-title"},"Playlist Exporter v4.2.6"),h("p",{className:"pe4-subtitle"},"Independent export profiles, schedules, folders, CSV layouts and album art export for every playlist."))),
        h("div",{className:"pe4-header-actions"},
          h(StatusPill,{status}),
          h("button",{type:"button",className:"pe4-button",onClick:()=>openPlaylistExporter("settings")},h(Icon,{name:"settings",size:15}),"Settings")
        )
      ),
      h("div",{className:"pe4-stats"},h(StatCard,{label:"Library playlists",value:playlists.length}),h(StatCard,{label:"Selected now",value:selectedCount}),h(StatCard,{label:"Automatic exports",value:autoCount}),h(StatCard,{label:"Last export",value:formatDateTime(config.lastAnyExportTime)})),
      message?h("div",{className:"pe4-banner","data-kind":messageKind},message,status==="exporting"&&progress.total?h("div",{className:"pe4-progress"},h("div",{className:"pe4-progress-bar",style:{width:`${progressPercent}%`}})):null):status==="exporting"?h("div",{className:"pe4-banner"},progress.label,h("div",{className:"pe4-progress"},h("div",{className:"pe4-progress-bar",style:{width:`${progressPercent}%`}}))):null,
      h("div",{className:"pe4-layout"},
        h("section",{className:"pe4-panel"},
          h("div",{className:"pe4-panel-head"},h("h2",{className:"pe4-panel-title"},"Playlists"),h("p",{className:"pe4-panel-copy"},"Select playlists for a manual batch export. Click a playlist row to edit its own export profile.")),
          h("div",{className:"pe4-toolbar"},
            h("div",{className:"pe4-search-wrap"},h("span",{className:"pe4-search-icon"},h(Icon,{name:"search",size:15})),h("input",{className:"pe4-search",type:"search",value:search,placeholder:"Search playlists",onChange:(e)=>setSearch(e.target.value)})),
            h("button",{className:"pe4-button",type:"button",onClick:selectVisible,disabled:busy||!filteredPlaylists.length},"Select all"),
            h("button",{className:"pe4-button",type:"button",onClick:clearSelection,disabled:busy||!selectedCount},"Clear"),
            h("button",{className:"pe4-button pe4-button-square",type:"button",title:"Refresh library",onClick:()=>refreshLibrary(false),disabled:busy},h(Icon,{name:"refresh",size:15}))
          ),
          h("div",{className:"pe4-list"},
            status==="loading"&&!playlists.length?h("div",{className:"pe4-empty"},"Reading your Spotify library…"):
            !filteredPlaylists.length?h("div",{className:"pe4-empty"},search?"No playlists match your search.":"No playlists found. Open Your Library in Spotify, then refresh."):
            filteredPlaylists.map((playlist)=>{const profile=getProfile(config,playlist.id);return h("div",{key:playlist.id,className:"pe4-playlist-row","data-active":activePlaylist?.id===playlist.id,onClick:()=>setActivePlaylistId(playlist.id)},
              h("input",{className:"pe4-check",type:"checkbox",checked:config.selectedPlaylistIds.includes(playlist.id),onClick:(e)=>e.stopPropagation(),onChange:(e)=>setSelected(playlist.id,e.target.checked),"aria-label":`Select ${playlist.name} for manual export`}),
              h(PlaylistCover,{playlist}),
              h("div",{className:"pe4-row-main"},h("div",{className:"pe4-row-name"},playlist.name),h("div",{className:"pe4-row-detail"},`${playlist.ownerName}${Number.isFinite(playlist.trackCount)?` · ${playlist.trackCount} tracks`:""}`)),
              h("div",{className:"pe4-row-status"},profile.autoEnabled?h("span",{className:"pe4-chip pe4-chip-active"},`Auto ${formatInterval(profile.exportIntervalHours)}`):h("span",{className:"pe4-chip"},"Manual"),h("span",{className:"pe4-chip"},profile.exportDestination==="folder"?(profile.downloadFolderName||"Custom folder"):"Downloads"))
            );})
          ),
          h("div",{className:"pe4-toolbar",style:{borderTop:"1px solid var(--pe-border)",borderBottom:0}},h("button",{type:"button",className:"pe4-button pe4-button-primary",style:{width:"100%"},onClick:()=>handleManualExport(config.selectedPlaylistIds),disabled:busy||!selectedCount},h(Icon,{name:"download",size:16}),status==="exporting"?"Exporting…":`Export ${selectedCount||"selected"} now`))
        ),
        h("section",{className:"pe4-panel"},
          !activePlaylist||!activeProfile?h("div",{className:"pe4-empty"},"Choose a playlist to configure its export profile."):
          h("div",{className:"pe4-editor"},
            h("div",{className:"pe4-editor-header"},h(PlaylistCover,{playlist:activePlaylist,className:"pe4-editor-cover"}),h("div",{style:{minWidth:0}},h("h2",{className:"pe4-editor-name"},activePlaylist.name),h("div",{className:"pe4-editor-meta"},`${activePlaylist.ownerName} · ${Number.isFinite(activePlaylist.trackCount)?`${activePlaylist.trackCount} tracks · `:""}${activeProfile.lastExportTime?`Last exported ${formatDateTime(activeProfile.lastExportTime)}`:"Not exported yet"}`))),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Preset"),h("span",{className:"pe4-section-note"},"Applies CSV layout, sorting, filename and duplicate rules.")),
              h("div",{className:"pe4-preset-row"},h("select",{className:"pe4-select",value:allPresets.some((p)=>p.id===activeProfile.presetId)?activeProfile.presetId:"customized",onChange:(e)=>applyPreset(e.target.value)},h("option",{value:"customized",disabled:true},"Customized"),allPresets.map((preset)=>h("option",{key:preset.id,value:preset.id},preset.name))),activeProfile.presetId?.startsWith("custom-")?h("button",{type:"button",className:"pe4-button pe4-button-danger",onClick:deletePreset},"Delete"):h("span")),
              h("div",{className:"pe4-preset-save"},h("input",{className:"pe4-input",value:presetName,placeholder:"New preset name",onChange:(e)=>setPresetName(e.target.value)}),h("button",{type:"button",className:"pe4-button",onClick:savePreset,disabled:!presetName.trim()},"Save current as preset"))
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Schedule and destination"),h("span",{className:"pe4-section-note"},nextExportText(activeProfile))),
              h("div",{className:"pe4-switch-row"},h("div",{className:"pe4-switch-copy"},h("strong",null,"Automatic export"),h("span",null,"Each scheduled run refreshes the library and reads the latest playlist version first.")),h("input",{className:"pe4-switch",type:"checkbox",checked:activeProfile.autoEnabled,onChange:(e)=>toggleAuto(e.target.checked)})),
              h("div",{className:"pe4-grid-2",style:{marginTop:"10px"}},
                h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Export interval"),h("select",{className:"pe4-select",value:activeProfile.exportIntervalHours,disabled:!activeProfile.autoEnabled,onChange:(e)=>changeProfileField("exportIntervalHours",Number(e.target.value))},[[0.5,"Every 30 minutes"],[1,"Every hour"],[2,"Every 2 hours"],[3,"Every 3 hours"],[4,"Every 4 hours"],[6,"Every 6 hours"],[8,"Every 8 hours"],[12,"Every 12 hours"],[24,"Every 24 hours"]].map(([v,l])=>h("option",{key:v,value:v},l)))),
                h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Destination"),h("select",{className:"pe4-select",value:activeProfile.exportDestination,onChange:(e)=>changeProfileField("exportDestination",e.target.value)},h("option",{value:"downloads"},"Standard Downloads"),h("option",{value:"folder",disabled:!folderPickerSupported},"Custom folder")))
              ),
              activeProfile.exportDestination==="folder"?h("div",{style:{marginTop:"10px"}},h("div",{className:"pe4-grid-2"},h("button",{type:"button",className:"pe4-button",onClick:()=>chooseFolder(activePlaylist.id),disabled:busy||!folderPickerSupported},h(Icon,{name:"folder",size:15}),activeProfile.downloadFolderName?"Change folder":"Choose folder"),h("button",{type:"button",className:"pe4-button",onClick:()=>disconnectFolder(activePlaylist.id),disabled:busy},"Use Downloads")),h("div",{className:"pe4-note",style:{marginTop:"8px"}},activeProfile.downloadFolderName?`${activeProfile.downloadFolderName} · ${folderPermissions[activePlaylist.id]==="granted"?"write access ready":"permission may need reconnecting after Spotify restarts"}`:"No folder is connected yet. Automatic exports need a previously granted folder permission.")):null
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"CSV columns"),h("span",{className:"pe4-section-note"},"Exported columns are shown in their exact CSV order.")),
              h("div",{className:"pe4-column-groups"},
                h("div",{className:"pe4-column-block"},
                  h("div",{className:"pe4-column-block-head"},h("span",{className:"pe4-column-block-title"},"Exported columns"),h("span",{className:"pe4-column-block-count"},`${enabledColumns.length} selected`)),
                  h("div",{className:"pe4-selected-columns"},enabledColumns.map((column,pos)=>h("div",{key:column.id,className:"pe4-column-row"},
                    h("span",{className:"pe4-column-index",title:`CSV position ${pos+1}`},String(pos+1).padStart(2,"0")),
                    h("button",{className:"pe4-column-toggle",type:"button",title:`Remove ${column.label}`,"aria-label":`Remove ${column.label} from CSV`,onClick:()=>toggleColumn(column.id,false)},"✓"),
                    h("span",{className:"pe4-column-copy"},h("span",{className:"pe4-column-label",title:column.label},column.label),h("span",{className:"pe4-column-group"},column.group)),
                    h("button",{className:"pe4-order-button",type:"button",title:"Move column up",disabled:pos===0,onClick:()=>moveColumn(column.id,-1)},"↑"),
                    h("button",{className:"pe4-order-button",type:"button",title:"Move column down",disabled:pos===enabledColumns.length-1,onClick:()=>moveColumn(column.id,1)},"↓")
                  )))
                ),
                h("div",{className:"pe4-column-block"},
                  h("div",{className:"pe4-column-block-head"},h("span",{className:"pe4-column-block-title"},"Available columns"),h("span",{className:"pe4-column-block-count"},availableColumns.length?`${availableColumns.length} available`:"All enabled")),
                  availableColumns.length?h("div",{className:"pe4-available-columns"},availableColumns.map((column)=>h("button",{key:column.id,className:"pe4-column-available",type:"button",title:`Add ${column.label}`,"aria-label":`Add ${column.label} to CSV`,onClick:()=>toggleColumn(column.id,true)},h("span",{className:"pe4-column-add"},"+"),h("span",{className:"pe4-column-copy"},h("span",{className:"pe4-column-label"},column.label),h("span",{className:"pe4-column-group"},column.group))))):h("div",{className:"pe4-column-empty"},"Every available column is already enabled.")
                )
              )
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Album art"),h("span",{className:"pe4-section-note"},"Optional per-playlist cover export")),
              h("div",{className:"pe4-switch-row"},
                h("div",{className:"pe4-switch-copy"},h("strong",null,"Download cover images (.jpg)"),h("span",null,"Saves one image per unique album as “covers/Primary artist - Album.jpg”. With a custom folder they go into a covers subfolder (existing files are overwritten); with Standard Downloads the browser saves them one by one and may ask to allow multiple downloads.")),
                h("button",{type:"button",className:"pe4-toggle","data-on":activeProfile.downloadCovers,"aria-pressed":activeProfile.downloadCovers,title:activeProfile.downloadCovers?"Cover image download is enabled":"Cover image download is disabled",onClick:()=>changeProfileField("downloadCovers",!activeProfile.downloadCovers)},h(Icon,{name:"image",size:16}),h("span",{className:"pe4-toggle-track"}),h("span",{className:"pe4-toggle-state"},activeProfile.downloadCovers?"On":"Off"))
              ),
              h("div",{className:"pe4-note",style:{marginTop:"8px"}},"Prefer links instead of files? Add the “Album art URL” column from the Available columns list in the CSV columns section.")
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Sorting"),h("span",{className:"pe4-section-note"},"Sorting changes the CSV order, not the Spotify playlist.")),
              h("div",{className:"pe4-grid-2"},h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Primary sort"),h("select",{className:"pe4-select",value:activeProfile.sortPrimary,onChange:(e)=>changeProfileField("sortPrimary",e.target.value)},SORT_FIELDS.map(([id,label])=>h("option",{key:id,value:id},label)))),h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Direction"),h("select",{className:"pe4-select",value:activeProfile.sortPrimaryDirection,onChange:(e)=>changeProfileField("sortPrimaryDirection",e.target.value)},h("option",{value:"asc"},"Ascending"),h("option",{value:"desc"},"Descending")))),
              h("div",{className:"pe4-grid-2",style:{marginTop:"10px"}},h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Secondary sort"),h("select",{className:"pe4-select",value:activeProfile.sortSecondary,onChange:(e)=>changeProfileField("sortSecondary",e.target.value)},SORT_FIELDS.map(([id,label])=>h("option",{key:id,value:id},label)))),h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Direction"),h("select",{className:"pe4-select",value:activeProfile.sortSecondaryDirection,disabled:activeProfile.sortSecondary==="none",onChange:(e)=>changeProfileField("sortSecondaryDirection",e.target.value)},h("option",{value:"asc"},"Ascending"),h("option",{value:"desc"},"Descending"))))
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Filename and duplicates"),h("span",{className:"pe4-section-note"},"Filename tokens: {playlist_name}, {playlist_id}, {owner}, {date}, {time}, {timestamp}.")),
              h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Filename template"),h("input",{className:"pe4-input",value:activeProfile.filenameTemplate,onChange:(e)=>changeProfileField("filenameTemplate",e.target.value)})),
              h("div",{className:"pe4-grid-2",style:{marginTop:"10px"}},
                h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Existing file behavior"),h("select",{className:"pe4-select",value:activeProfile.overwriteBehavior,onChange:(e)=>changeProfileField("overwriteBehavior",e.target.value)},h("option",{value:"replace"},"Replace existing"),h("option",{value:"timestamp"},"Create timestamped copy"),h("option",{value:"increment"},"Create numbered copy"))),
                h("div",{className:"pe4-field"},h("label",{className:"pe4-label"},"Duplicate handling"),h("select",{className:"pe4-select",value:activeProfile.duplicateMode,onChange:(e)=>changeProfileField("duplicateMode",e.target.value)},h("option",{value:"keep"},"Keep every playlist entry"),h("option",{value:"exact"},"Remove exact Spotify track duplicates"),h("option",{value:"recording"},"Remove same recording across releases (ISRC)")))
              ),
              h("div",{className:"pe4-note",style:{marginTop:"8px"}},"Duplicate detection never compares track names alone. The recording mode uses ISRC when Spotify provides it, then falls back to Spotify track ID, so different songs with the same title are kept.")
            ),

            h("div",{className:"pe4-section"},
              h("div",{className:"pe4-section-title-row"},h("h3",{className:"pe4-section-title"},"Export configuration preview"),h("span",{className:"pe4-section-note"},`${activeProfile.columns.length} columns · ${activeProfile.duplicateMode==="keep"?"duplicates kept":activeProfile.duplicateMode==="recording"?"recording duplicates removed":"exact duplicates removed"}`)),
              h("div",{className:"pe4-preview"},h("div",{className:"pe4-preview-file"},previewFilename),h("div",{className:"pe4-preview-scroll"},h("table",{className:"pe4-preview-table"},h("thead",null,h("tr",null,previewColumns.map((c)=>h("th",{key:c.id},c.label)))),h("tbody",null,h("tr",null,previewColumns.map((c)=>h("td",{key:c.id},c.value(sample)))))))),
              h("div",{className:"pe4-actions"},h("button",{type:"button",className:"pe4-button pe4-button-primary",onClick:()=>handleManualExport([activePlaylist.id]),disabled:busy},h(Icon,{name:"download",size:16}),`Export ${activePlaylist.name} now`),h("button",{type:"button",className:"pe4-button",onClick:()=>refreshLibrary(false),disabled:busy},h(Icon,{name:"refresh",size:15}),"Refresh library"))
            )
          )
        )
      )
    )
  );
}


function PlaylistExporterSettings() {
  const config = loadConfig();
  const autoCount = Object.values(config.playlistProfiles || {}).filter((profile)=>normalizeProfile(profile).autoEnabled).length;
  const profileCount = Object.keys(config.playlistProfiles || {}).length;
  const customPresetCount = (config.customPresets || []).length;
  const folderPickerSupported = typeof window.showDirectoryPicker === "function";

  return h(React.Fragment,null,
    h("style",{dangerouslySetInnerHTML:{__html:APP_CSS}}),
    h("main",{className:"pe4-app"},
      h("header",{className:"pe4-header"},
        h("div",{className:"pe4-title-wrap"},
          h("div",{className:"pe4-logo"},h(Icon,{name:"settings",size:22})),
          h("div",null,
            h("h1",{className:"pe4-title"},"Playlist Exporter settings"),
            h("p",{className:"pe4-subtitle"},"Global information, support and local extension data.")
          )
        ),
        h("div",{className:"pe4-header-actions"},
          h("button",{type:"button",className:"pe4-button pe4-button-primary",onClick:()=>openPlaylistExporter("exporter")},h(Icon,{name:"download",size:15}),"Open exporter")
        )
      ),
      h("div",{className:"pe4-settings-wrap"},
        h("div",{className:"pe4-settings-grid"},
          h("section",{className:"pe4-settings-card"},
            h("h2",null,"Extension"),
            h("p",null,"Playlist-specific export options are configured from the main Exporter."),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Version"),h("span",{className:"pe4-settings-value"},"4.2.6")),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Automatic scheduler"),h("span",{className:"pe4-settings-value"},autoCount?`${autoCount} playlist${autoCount===1?"":"s"} enabled`:"No schedules enabled")),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Custom folders"),h("span",{className:"pe4-settings-value"},folderPickerSupported?"Supported by this Spotify build":"Unavailable in this Spotify build"))
          ),
          h("section",{className:"pe4-settings-card"},
            h("h2",null,"Local data"),
            h("p",null,"Settings stay on this Spotify installation. Playlist Exporter does not send configuration or telemetry anywhere."),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Saved playlist profiles"),h("span",{className:"pe4-settings-value"},String(profileCount))),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Custom presets"),h("span",{className:"pe4-settings-value"},String(customPresetCount))),
            h("div",{className:"pe4-settings-row"},h("strong",null,"Successful exports"),h("span",{className:"pe4-settings-value"},String(config.totalExportedFiles || 0)))
          ),
          h("section",{className:"pe4-settings-card pe4-settings-wide"},
            h("h2",null,"Support & feedback"),
            h("p",null,"Found a bug or have an idea? GitHub Issues keeps reports and suggestions in one place."),
            h("div",{className:"pe4-actions"},
              h("a",{className:"pe4-button pe4-button-danger",href:BUG_REPORT_URL,target:"_blank",rel:"noopener noreferrer"},"Report a bug"),
              h("a",{className:"pe4-button",href:FEATURE_REQUEST_URL,target:"_blank",rel:"noopener noreferrer"},"Suggest a feature"),
              h("a",{className:"pe4-button",href:PROJECT_URL,target:"_blank",rel:"noopener noreferrer"},"View on GitHub")
            )
          )
        )
      )
    )
  );
}

class PlaylistExporterErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return{error};}
  componentDidCatch(error,info){console.error("[Playlist Exporter] React render failure:",error,info);}
  render(){if(!this.state.error)return this.props.children;return h("div",{style:{padding:"32px",color:"var(--spice-text)"}},h("h2",null,"Playlist Exporter could not render"),h("pre",{style:{marginTop:"16px",whiteSpace:"pre-wrap",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",padding:"16px",borderRadius:"10px"}},String(this.state.error?.stack||this.state.error)));}
}



// ---- Extension shell -------------------------------------------------------
// The exporter used to be a Custom App that owned its own Spotify route.
// As an extension, it is opened from a top-bar button (or the Spicetify menu)
// and mounted into a full-window overlay. The export scheduler stays active
// even while this UI is closed.

const EXTENSION_SHELL_CSS = `
.pe4-extension-host {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: auto;
  overscroll-behavior: contain;
  background: color-mix(in srgb, var(--spice-main, #121212) 72%, transparent);
  backdrop-filter: blur(16px) saturate(115%);
  -webkit-backdrop-filter: blur(16px) saturate(115%);
  color: var(--spice-text, #fff);
}
.pe4-extension-host .pe4-extension-close {
  position: fixed;
  top: 58px;
  right: 24px;
  z-index: 2;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 999px;
  background: rgba(0,0,0,.55);
  color: var(--spice-text, #fff);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: transform .12s ease, background .15s ease, border-color .15s ease;
}
.pe4-extension-host .pe4-extension-close:hover {
  transform: translateY(-1px);
  background: rgba(255,255,255,.12);
  border-color: rgba(255,255,255,.28);
}
.pe4-extension-host .pe4-extension-close:focus-visible {
  outline: 2px solid var(--spice-button, #1ed760);
  outline-offset: 2px;
}
body.pe4-extension-open {
  overflow: hidden !important;
}
`;

let extensionHost = null;
let extensionReactRoot = null;
let extensionEscapeHandler = null;

function unmountExtensionUI() {
  if (!extensionHost) return;
  try {
    if (extensionReactRoot?.unmount) extensionReactRoot.unmount();
    else if (Spicetify.ReactDOM?.unmountComponentAtNode) Spicetify.ReactDOM.unmountComponentAtNode(extensionHost);
  } catch (error) {
    console.warn("[Playlist Exporter] Could not cleanly unmount extension UI:", error);
  }
  if (extensionEscapeHandler) document.removeEventListener("keydown", extensionEscapeHandler, true);
  extensionEscapeHandler = null;
  extensionReactRoot = null;
  extensionHost.remove();
  extensionHost = null;
  document.body.classList.remove("pe4-extension-open");
}

function ExtensionShell({ mode = "exporter" }) {
  return h(
    "div",
    { className: "pe4-extension-host", role: "dialog", "aria-modal": true, "aria-label": "Playlist Exporter" },
    h("style", { dangerouslySetInnerHTML: { __html: EXTENSION_SHELL_CSS } }),
    h(
      "button",
      {
        type: "button",
        className: "pe4-extension-close",
        title: "Close Playlist Exporter",
        "aria-label": "Close Playlist Exporter",
        onClick: unmountExtensionUI
      },
      h(Icon, { name: "close", size: 20 })
    ),
    h(PlaylistExporterErrorBoundary, null, mode === "settings" ? h(PlaylistExporterSettings) : h(PlaylistExporterApp))
  );
}

function mountReact(element, host) {
  if (typeof Spicetify.ReactDOM?.createRoot === "function") {
    extensionReactRoot = Spicetify.ReactDOM.createRoot(host);
    extensionReactRoot.render(element);
    return;
  }
  if (typeof Spicetify.ReactDOM?.render === "function") {
    Spicetify.ReactDOM.render(element, host);
    extensionReactRoot = null;
    return;
  }
  throw new Error("This Spotify/Spicetify build does not expose a supported ReactDOM renderer.");
}

function openPlaylistExporter(mode = "exporter") {
  if (extensionHost?.isConnected) {
    if (extensionHost.dataset.peMode === mode) {
      extensionHost.focus?.();
      return;
    }
    unmountExtensionUI();
  }

  extensionHost = document.createElement("div");
  extensionHost.dataset.peMode = mode;
  extensionHost.id = "playlist-exporter-extension-root";
  extensionHost.tabIndex = -1;
  document.body.appendChild(extensionHost);
  document.body.classList.add("pe4-extension-open");

  extensionEscapeHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      unmountExtensionUI();
    }
  };
  document.addEventListener("keydown", extensionEscapeHandler, true);

  try {
    mountReact(h(ExtensionShell, { mode }), extensionHost);
    extensionHost.focus();
  } catch (error) {
    console.error("[Playlist Exporter] Could not open extension UI:", error);
    unmountExtensionUI();
    Spicetify.showNotification?.("Playlist Exporter could not open. Check the Spotify developer console.", true, 8000);
  }
}

const TOPBAR_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v10m0 0 4-4m-4 4-4-4M5 16v4h14v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

startGlobalScheduler();

try {
  window.__playlistExporterV4TopbarButton = new Spicetify.Topbar.Button(
    "Playlist Exporter",
    TOPBAR_ICON,
    () => openPlaylistExporter("exporter"),
    false,
    true
  );
  // Vanilla Spotify can hide the left custom-button slot on some layouts.
  // Use the documented right-side Topbar slot, while opting the control out
  // of the Windows/Electron draggable title-bar region.
  if (window.__playlistExporterV4TopbarButton?.element) {
    const buttonElement = window.__playlistExporterV4TopbarButton.element;
    buttonElement.style.pointerEvents = "auto";
    buttonElement.style.webkitAppRegion = "no-drag";
    buttonElement.style.position = "relative";
    buttonElement.style.zIndex = "20";
    buttonElement.style.cursor = "pointer";
  }
} catch (error) {
  console.warn("[Playlist Exporter] Could not register top-bar button:", error);
}

if (Spicetify.Menu?.Item) {
  try {
    window.__playlistExporterV4MenuItem = new Spicetify.Menu.Item(
      "Playlist Exporter settings",
      false,
      () => openPlaylistExporter("settings")
    );
    window.__playlistExporterV4MenuItem.register();
  } catch (error) {
    console.warn("[Playlist Exporter] Could not register Spicetify menu item:", error);
  }
}

console.info("[Playlist Exporter] Extension 4.2.6 loaded.");
  }

  init();
})();
