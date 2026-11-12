const rtf = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
  style: "short",
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Relative time against a fixed "now" so the prototype renders deterministically. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return "";
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) =>
  dateTimeFmt.format(new Date(iso));
export const formatNumber = (n: number) =>
  new Intl.NumberFormat("en").format(n);

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

/** Bytes → "340 B"/"1.5 MiB"/"12 GiB" (binary units, one decimal under 10). */
export const formatBytes = (n: number) => {
  let v = n;
  let u = 0;
  while (v >= 1024 && u < BYTE_UNITS.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${u === 0 ? v : v.toFixed(v >= 10 ? 0 : 1)} ${BYTE_UNITS[u]}`;
};

export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** 0..1 ratio → "97.50%" ("100%" when whole); null → "—". */
export const formatPct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(v === 1 ? 0 : 2)}%`;

/** Milliseconds → "340 ms"; null → "—". */
export const formatMs = (v: number | null) =>
  v == null ? "—" : `${Math.round(v)} ms`;

export function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
