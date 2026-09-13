/**
 * URL allowlist for URL-fetching importers (2026-09-10 assessment finding:
 * the web-url and api-url importers fetched arbitrary URLs, enabling SSRF
 * against loopback, RFC-1918, link-local, and cloud-metadata addresses).
 *
 * This validates the URL *as written*. It cannot defend against DNS
 * rebinding — a public hostname may resolve to a private address later — so
 * deployers should additionally restrict egress. Documented as residual
 * risk in ADR-106.
 */

function ipv4ToInt(parts: number[]): number {
  return parts[0]! * 2 ** 24 + parts[1]! * 2 ** 16 + parts[2]! * 2 ** 8 + parts[3]!;
}

/** [network, prefixBits, label] */
const BLOCKED_IPV4: Array<[number, number, string]> = [
  [ipv4ToInt([0, 0, 0, 0]), 8, "unspecified/this-network"],
  [ipv4ToInt([10, 0, 0, 0]), 8, "private (RFC 1918)"],
  [ipv4ToInt([100, 64, 0, 0]), 10, "CGNAT shared address space"],
  [ipv4ToInt([127, 0, 0, 0]), 8, "loopback"],
  [ipv4ToInt([169, 254, 0, 0]), 16, "link-local / cloud metadata"],
  [ipv4ToInt([172, 16, 0, 0]), 12, "private (RFC 1918)"],
  [ipv4ToInt([192, 0, 0, 0]), 24, "IETF protocol assignments"],
  [ipv4ToInt([192, 168, 0, 0]), 16, "private (RFC 1918)"],
  [ipv4ToInt([198, 18, 0, 0]), 15, "benchmarking (RFC 2544)"],
  [ipv4ToInt([224, 0, 0, 0]), 4, "multicast"],
  [ipv4ToInt([240, 0, 0, 0]), 4, "reserved"],
];

function parseIpv4(host: string): number[] | null {
  const octets = host.split(".").map((p) => Number(p));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return null;
  }
  return octets;
}

function ipv4BlockedReason(host: string): string | null {
  const octets = parseIpv4(host);
  if (!octets) return null; // not an IPv4 literal
  const ip = ipv4ToInt(octets);
  for (const [network, bits, label] of BLOCKED_IPV4) {
    const div = 2 ** (32 - bits);
    if (Math.floor(ip / div) === Math.floor(network / div)) {
      return `IPv4 address is in a blocked range (${label})`;
    }
  }
  return null;
}

/** Parse an IPv6 literal (without brackets) into 8 hextets, or null. */
function parseIpv6(host: string): number[] | null {
  let h = host.toLowerCase();
  if (h.includes(".")) {
    // Embedded IPv4 tail, e.g. ::ffff:127.0.0.1
    const idx = h.lastIndexOf(":");
    const octets = h.slice(idx + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    h =
      h.slice(0, idx + 1) +
      ((octets[0]! << 8) | octets[1]!).toString(16) +
      ":" +
      ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const parts = [...left, ...new Array(missing).fill("0"), ...right];
  const nums = parts.map((p) => (p === "" ? NaN : parseInt(p, 16)));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function ipv6BlockedReason(host: string): string | null {
  const parts = parseIpv6(host);
  if (!parts) return "invalid IPv6 address";

  const first = parts[0]!;
  const lastTwo = [parts[6]!, parts[7]!];

  // IPv4-mapped/compatible addresses → apply the IPv4 rules to the tail.
  const isV4Mapped = parts.slice(0, 5).every((p) => p === 0) && parts[5] === 0xffff;
  const isV4Compatible = parts.slice(0, 6).every((p) => p === 0) && (parts[6] !== 0 || parts[7]! > 1);
  if (isV4Mapped || isV4Compatible) {
    const v4 = [(lastTwo[0]! >> 8) & 0xff, lastTwo[0]! & 0xff, (lastTwo[1]! >> 8) & 0xff, lastTwo[1]! & 0xff];
    return ipv4BlockedReason(v4.join("."));
  }

  if (parts.every((p) => p === 0)) return "IPv6 unspecified address (::) is blocked";
  if (parts.slice(0, 7).every((p) => p === 0) && parts[7] === 1) return "IPv6 loopback (::1) is blocked";
  if ((first & 0xfe00) === 0xfc00) return "IPv6 unique-local (fc00::/7) is blocked";
  if ((first & 0xffc0) === 0xfe80) return "IPv6 link-local (fe80::/10) is blocked";
  if ((first & 0xff00) === 0xff00) return "IPv6 multicast (ff00::/8) is blocked";
  return null;
}

/** Returns a human-readable rejection reason, or null when the URL is allowed. */
export function urlSafetyError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a valid URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `unsupported protocol "${parsed.protocol}"`;
  }

  // WHATWG URL parsing already normalizes decimal/hex/octal IPv4 hostnames
  // (e.g. http://2130706433/ → 127.0.0.1) into canonical form here.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");

  if (host === "") return "empty hostname";
  if (host === "localhost" || host.endsWith(".localhost")) return "localhost is not allowed";
  if (host.endsWith(".local")) return "mDNS .local hostnames are not allowed";

  if (host.startsWith("[") && host.endsWith("]")) {
    const reason = ipv6BlockedReason(host.slice(1, -1));
    if (reason) return reason;
  } else if (/^[0-9.]+$/.test(host)) {
    if (!parseIpv4(host)) return "invalid IPv4 address";
    const reason = ipv4BlockedReason(host);
    if (reason) return reason;
  }

  return null;
}

export function isUrlAllowedForImport(url: string): boolean {
  return urlSafetyError(url) === null;
}

export function assertUrlAllowedForImport(url: string): void {
  const reason = urlSafetyError(url);
  if (reason) {
    throw new Error(`URL is not allowed for import: ${reason}`);
  }
}
