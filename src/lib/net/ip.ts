/**
 * IP address classification for SSRF protection. Pure functions; fail closed (anything we cannot parse is "private").
 */
import { isIPv4, isIPv6 } from 'node:net';

export function parseIPv4(s: string): [number, number, number, number] | null {
  if (!isIPv4(s)) return null;
  const parts = s.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

/** Parses an IPv6 address (with optional [brackets], %zone and embedded IPv4 tail) into 8 hextets. */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!isIPv6(s)) return null;

  let v4Tail: [number, number] | null = null;
  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = parseIPv4(lastPart);
    if (!v4) return null;
    v4Tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1) + '0:0';
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const hextets = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  if (hextets.some((n) => Number.isNaN(n))) return null;
  if (v4Tail) {
    hextets[6] = v4Tail[0];
    hextets[7] = v4Tail[1];
  }
  return hextets;
}

/**
 * True for addresses we must never connect to: private (RFC 1918), loopback, link-local, CGNAT, "this network",
 * documentation/benchmark ranges, multicast, reserved and broadcast (IPv4); unspecified, loopback, IPv4-mapped,
 * IPv4-compatible/translated, ULA, link-local, site-local, multicast, discard, documentation, Teredo and anything
 * outside global unicast 2000::/3 (IPv6). NAT64 and 6to4 addresses are judged by the IPv4 address they embed.
 */
export function isPrivateIp(address: string): boolean {
  const v4 = parseIPv4(address.trim());
  if (v4) return isPrivateV4(v4);
  const v6 = parseIPv6(address);
  if (!v6) return true; // not an IP address at all: fail closed
  return isPrivateV6(v6);
}

function isPrivateV4([a, b, c]: readonly number[]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network" / unspecified
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast
  return false;
}

function v4FromHextets(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateV6(h: readonly number[]): boolean {
  const zeroUpTo = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(6)) return true; // ::, ::1 and IPv4-compatible ::/96
  if (zeroUpTo(5) && h[5] === 0xffff) return true; // IPv4-mapped ::ffff:0:0/96 (always blocked)
  if (zeroUpTo(4) && h[4] === 0xffff && h[5] === 0) return true; // IPv4-translated ::ffff:0:0:0/96
  if (h[0] === 0x64 && h[1] === 0xff9b) {
    if (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) return isPrivateV4(v4FromHextets(h[6], h[7])); // NAT64
    return true; // 64:ff9b:1::/48 local-use NAT64 and the rest of the block
  }
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true; // discard-only 100::/64
  if ((h[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated) fec0::/10
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (h[0] === 0x2001 && h[1] < 0x0200) return true; // 2001::/23 IETF protocol assignments (incl. Teredo 2001::/32)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if (h[0] === 0x3fff && h[1] <= 0x0fff) return true; // documentation 3fff::/20
  if (h[0] === 0x2002) return isPrivateV4(v4FromHextets(h[1], h[2])); // 6to4 embeds an IPv4 address
  if ((h[0] & 0xe000) !== 0x2000) return true; // outside global unicast 2000::/3
  return false;
}
