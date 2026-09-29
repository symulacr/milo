import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const documents = [
  "01-blueprint.md",
  "02-roadmap.md",
  "03-building-guide.md",
  "04-ui-design.md",
  "05-ux-design.md",
  "06-backend-design.md",
  "07-video-design.md",
  "08-midnight-core-audit.md",
];
const texts = await Promise.all(documents.map((path) => Bun.file(path).text()));
const combined = texts.join("\n");
for (const [prefix, count, padded, first] of [
  ["B-", 11, true, 1],
  ["MID-P", 6, false, 1],
  ["MID-T", 14, true, 1],
  ["M-", 14, true, 1],
  ["R", 6, false, 0],
] as const) {
  for (let i = first; i < first + count; i++) {
    const id = prefix + (padded ? String(i).padStart(2, "0") : String(i));
    assert(
      new RegExp(`\\b${id}(?!\\d)`).test(combined),
      `Missing canonical ID: ${id}`,
    );
  }
}
let links = 0;
for (const [index, text] of texts.entries()) {
  const path = documents[index];
  assert(path);
  let fence: string | undefined;
  const prose = text
    .split("\n")
    .filter((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (match?.[1]) {
        if (!fence) fence = match[1];
        else if (match[1][0] === fence[0] && match[1].length >= fence.length)
          fence = undefined;
        return false;
      }
      return !fence;
    })
    .join("\n");
  assert.equal(fence, undefined, `Unclosed code fence: ${path}`);
  for (const match of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (!href || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
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
console.log(
  `Verified ${documents.length} canonical documents, 51 gate IDs, code fences and ${links} relative link targets (not anchor or external-page validation).`,
);
