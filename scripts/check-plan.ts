import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const documents = [
  "docs/plan/01-blueprint.md",
  "docs/plan/02-roadmap.md",
  "docs/plan/03-building-guide.md",
  "docs/plan/04-ui-design.md",
  "docs/plan/05-ux-design.md",
  "docs/plan/06-backend-design.md",
  "docs/plan/07-video-design.md",
  "docs/plan/08-midnight-core-audit.md",
];

const gateIds = [
  ["B-", 11, true, 1],
  ["MID-P", 6, false, 1],
  ["MID-T", 14, true, 1],
  ["M-", 14, true, 1],
  ["R", 6, false, 0],
] as const;

export const prefixes = ["B-", "MID-P", "MID-T", "M-", "R"] as const;
export type Prefix = (typeof prefixes)[number];

export type GateId = { prefix: Prefix; num: number };

const prefixAlias: ReadonlyMap<string, Prefix> = new Map([
  ["B", "B-"],
  ["B-", "B-"],
  ["M", "M-"],
  ["M-", "M-"],
  ["R", "R"],
  ["R-", "R"],
  ["P", "MID-P"],
  ["MID-P", "MID-P"],
  ["T", "MID-T"],
  ["MID-T", "MID-T"],
]);

const writtenId = /^(?:MID-P|MID-T|B-|M-|R)(\d{1,3})$/;
const explicitRe = /\b(?:MID-P|MID-T|B-|M-|R)\d{1,3}\b/g;
const rangeRe =
  /\b((?:MID-P|MID-T|B-|M-|R))(\d{1,3})\s*(?:–|—|--|\.\.)\s*((?:MID-P|MID-T|B-|M-|R-|B|M|R|P|T)?)(\d{1,3})\b/g;
const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
const linkRe = /\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i;

const MAX_RANGE_SPAN = 64;
const UNPADDED: ReadonlySet<Prefix> = new Set<Prefix>(["MID-P", "R"]);

export function parseId(text: string): GateId | undefined {
  const digits = writtenId.exec(text)?.[1];
  if (digits === undefined) return undefined;
  const prefix = prefixAlias.get(text.slice(0, text.length - digits.length));
  const num = Number(digits);
  if (!prefix || !Number.isInteger(num)) return undefined;
  return { prefix, num };
}

export function parseRange(
  leftPrefix: string,
  leftDigits: string,
  rightPrefix: string,
  rightDigits: string,
): GateId[] {
  const from = prefixAlias.get(leftPrefix);
  const to = prefixAlias.get(rightPrefix === "" ? leftPrefix : rightPrefix);
  if (!from || !to || from !== to) return [];
  const low = Number(leftDigits);
  const high = Number(rightDigits);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return [];
  if (high < low || high - low > MAX_RANGE_SPAN) return [];
  const ids: GateId[] = [];
  for (let num = low; num <= high; num++) ids.push({ prefix: from, num });
  return ids;
}

export function formatId({ prefix, num }: GateId): string {
  const digits = UNPADDED.has(prefix)
    ? String(num)
    : String(num).padStart(2, "0");
  return prefix + digits;
}

export type ClaimedIds = { literal: Set<string>; covered: Set<string> };

export function collectClaimedIds(text: string): ClaimedIds {
  const literal = new Set<string>();
  const covered = new Set<string>();
  for (const match of text.matchAll(explicitRe)) {
    const id = parseId(match[0]);
    if (id) literal.add(formatId(id));
  }
  for (const match of text.matchAll(rangeRe)) {
    for (const id of parseRange(
      match[1] ?? "",
      match[2] ?? "",
      match[3] ?? "",
      match[4] ?? "",
    ))
      covered.add(formatId(id));
  }
  return { literal, covered };
}

export function missingGateIds(claimed: ClaimedIds): string[] {
  const missing: string[] = [];
  for (const [prefix, count, padded, first] of gateIds) {
    for (let i = first; i < first + count; i++) {
      const id = prefix + (padded ? String(i).padStart(2, "0") : String(i));
      if (!claimed.literal.has(id) && !claimed.covered.has(id))
        missing.push(id);
    }
  }
  return missing;
}

export function scanFences(text: string): { prose: string; unclosed?: string } {
  let fence: string | undefined;
  const prose = text
    .split("\n")
    .filter((line) => {
      const match = line.match(fenceRe);
      if (match?.[1]) {
        if (!fence) fence = match[1];
        else if (match[1][0] === fence[0] && match[1].length >= fence.length)
          fence = undefined;
        return false;
      }
      return !fence;
    })
    .join("\n");
  return { prose, unclosed: fence };
}

export async function checkDocuments(): Promise<string> {
  const texts = await Promise.all(
    documents.map((path) => Bun.file(path).text()),
  );
  const claimed = collectClaimedIds(texts.join("\n"));
  const missing = missingGateIds(claimed);
  assert.deepEqual(missing, [], `Missing canonical IDs: ${missing.join(", ")}`);
  let links = 0;
  for (const [index, text] of texts.entries()) {
    const path = documents[index];
    assert(path);
    const { prose, unclosed } = scanFences(text);
    assert.equal(unclosed, undefined, `Unclosed code fence: ${path}`);
    for (const match of prose.matchAll(linkRe)) {
      const href = match[1];
      if (!href || EXTERNAL.test(href)) continue;
      const target = resolve(
        dirname(path),
        decodeURIComponent(href.split("#")[0] ?? ""),
      );
      assert(
        target.startsWith(resolve(".") + sep),
        `Link escapes repository: ${path}`,
      );
      await access(target);
      links++;
    }
  }
  const byRange = [...claimed.covered].filter((id) => !claimed.literal.has(id));
  return `Verified ${documents.length} canonical documents, 51 gate IDs (${byRange.length} satisfied by an explicit same-prefix range), code fences and ${links} relative link targets (not anchor or external-page validation).`;
}

if (import.meta.main) console.log(await checkDocuments());
