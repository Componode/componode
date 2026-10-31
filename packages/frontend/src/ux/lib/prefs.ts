/**
 * Client display preferences (spec 041, gap G20) — persisted per device in
 * `localStorage["ux.prefs"]`, consumed app-wide. Defaults render the app
 * exactly as before; every pref is opt-in.
 */
import { useSyncExternalStore, useLayoutEffect } from "react";

const PREFS_KEY = "ux.prefs";
const EVENT = "ux:prefs";

export interface UxPrefs {
  density: "comfortable" | "compact";
  reduceMotion: boolean;
  relativeTime: boolean;
}

const DEFAULTS: UxPrefs = {
  density: "comfortable",
  reduceMotion: false,
  relativeTime: true,
};

function readRaw(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadPrefs(): UxPrefs {
  const raw = readRaw();
  return {
    density: raw.density === "compact" ? "compact" : "comfortable",
    reduceMotion: raw.reduceMotion === true,
    relativeTime: raw.relativeTime !== false,
  };
}

export function savePref<K extends keyof UxPrefs>(key: K, value: UxPrefs[K]): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readRaw(), [key]: value }));
  window.dispatchEvent(new Event(EVENT));
}

// Snapshot memoized on the raw storage string — a cheap `getItem` per
// render detects change (writes, clears, devtools edits); JSON parsing
// happens only when the value actually differs.
let rawCache = localStorage.getItem(PREFS_KEY) ?? "";
let snapshot: UxPrefs = loadPrefs();

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot(): UxPrefs {
  const raw = localStorage.getItem(PREFS_KEY) ?? "";
  if (raw !== rawCache) {
    rawCache = raw;
    snapshot = loadPrefs();
  }
  return snapshot;
}

export function useUxPrefs(): UxPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
}

/**
 * Applies the two root-signal prefs — `data-density` and
 * `data-reduce-motion` on <html> so the stylesheet rules cascade app-wide.
 * Mount once at the UX shell.
 */
export function UxPrefsSync() {
  const prefs = useUxPrefs();
  // layoutEffect: attributes land before first paint — no density/motion flash.
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.dataset.density = prefs.density;
    if (prefs.reduceMotion) el.setAttribute("data-reduce-motion", "");
    else el.removeAttribute("data-reduce-motion");
    return () => {
      delete el.dataset.density;
      el.removeAttribute("data-reduce-motion");
    };
  }, [prefs.density, prefs.reduceMotion]);
  return null;
}
