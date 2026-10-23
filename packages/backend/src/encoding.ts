export const HEX64 = /^[a-f0-9]{64}$/;
const PAIRS = Array.from(
  { length: 256 },
  (_, i) => (i < 16 ? "0" : "") + i.toString(16),
);
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < 10; i++) VALUES[48 + i] = i;
for (let i = 0; i < 6; i++) VALUES[97 + i] = VALUES[65 + i] = 10 + i;
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < out.length; i++) {
    const hi = VALUES[hex.charCodeAt(i * 2)] ?? -1;
    const lo = VALUES[hex.charCodeAt(i * 2 + 1)] ?? -1;
    if (hi < 0 || lo < 0) throw new Error("invalid hex");
    out[i] = (hi << 4) | lo;
  }
  return out;
}
export function bytesToHex(b: Uint8Array | ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += PAIRS[b[i] & 0xff];
  return s;
}
