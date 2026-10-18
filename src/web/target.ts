import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Resolves a host name to every address it currently points at. */
export type AddressResolver = (hostname: string) => Promise<string[]>;

export const systemResolver: AddressResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
};

/** True only for addresses a public HTTP(S) request may connect to. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet)))
    return false;
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF and TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast and reserved
  return true;
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return false;
  const [first = 0, second = 0] = groups;
  const firstFiveZero = groups.slice(0, 5).every((group) => group === 0);
  if (firstFiveZero && groups[5] === 0xffff)
    return isPublicIpv4(joinIpv4(((groups[6] ?? 0) << 16) | (groups[7] ?? 0)));
  if (groups.slice(0, 6).every((group) => group === 0)) return false; // unspecified, loopback, and IPv4-compatible ranges
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && (second === 0x0db8 || second === 0)) return false; // documentation, Teredo
  if (first === 0x2002) return false; // deprecated 6to4
  if (first === 0x0064 && second === 0xff9b) return false; // NAT64
  if (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0))
    return false; // discard-only
  return true;
}

/** Expands an IPv6 address into eight 16-bit groups; null when it is malformed. */
function parseIpv6(address: string): number[] | null {
  const text =
    address
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from<number>({ length: missing }).fill(0), ...tail];
}

function groupsOf(part: string): number[] | null {
  if (part === "") return [];
  const groups: number[] = [];
  const pieces = part.split(":");
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1) return null;
      const octets = piece.split(".").map(Number);
      if (octets.length !== 4) return null;
      if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255))
        return null;
      const [a = 0, b = 0, c = 0, d = 0] = octets;
      groups.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
    groups.push(Number.parseInt(piece, 16));
  }
  return groups;
}

function joinIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    ".",
  );
}
