import tailwind from "bun-plugin-tailwind";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { PublicApp } from "../apps/web/src/public-main";
import {
  publicAppRoutes,
  workspaceAppRoutes,
  zkVersion,
} from "../apps/web/src/route-table";
import { PAGES } from "../apps/web/src/routes/InfoPage";
import {
  cloudflareHeaders,
  cloudflareRedirects,
  narrowCsp,
  publicConfig,
} from "../packages/backend/src/public-config";
import { wasmBindings } from "./wasm-bindings-plugin";

const browserConfig = publicConfig(process.env);

const outdir = "dist";
const buildEntrypoints = ".tools/build-entrypoints";

const HTML_NAMES = ["index", "app", "public-app"] as const;

const STAGE_PAIRS = [
  [/((?:href|src)=")\.\/src\//g, "$1../../apps/web/src/"],
  [/((?:href|src|content)=")\.\/public\//g, "$1../../apps/web/public/"],
] as const;

const EMITTED_PATTERN = /\.\.\/\.\.\/apps\/web\/(?:public|src)\//g;

const transform = async (
  path: string,
  pairs: readonly (readonly [RegExp, string])[],
): Promise<string> => {
  let text = await Bun.file(path).text();
  for (const [pattern, replacement] of pairs)
    text = text.replaceAll(pattern, replacement);
  return text;
};

const prepareHtmlEntrypoint = async (name: string): Promise<number> =>
  Bun.write(
    `${buildEntrypoints}/${name}.html`,
    await transform(`apps/web/${name}.html`, STAGE_PAIRS),
  );

await Bun.$`rm -rf ${outdir} ${buildEntrypoints}`;
await Bun.$`mkdir -p ${buildEntrypoints}`;

await Promise.all(HTML_NAMES.map(prepareHtmlEntrypoint));

const zkSource = "packages/contract/generated";

const result = await Bun.build({
  entrypoints: HTML_NAMES.map((name) => `${buildEntrypoints}/${name}.html`),
  outdir,
  root: buildEntrypoints,
  publicPath: "/",
  minify: true,
  plugins: [tailwind, wasmBindings()],
  define: {
    "process.env.NODE_ENV": '"production"',
    // Substituted textually into the client bundle, where runtime.ts reads it as
    // `__ZK_VERSION__` behind a `typeof` guard so a test run without it is safe.
    __ZK_VERSION__: JSON.stringify(zkVersion),
  },
  splitting: true,
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

await Bun.$`rm -rf ${buildEntrypoints}`;

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

// Open Graph needs absolute URLs: a relative og:image is dropped by every
// consumer, so a share of Milo would have no card. SITE_URL is the deployment's
// own origin (see .env.example); without it the relative value stays rather than
// shipping a broken absolute one, the same posture as the CSP rewrite.
const siteOrigin = (process.env.SITE_URL ?? "")
  .split(",")[0]
  .trim()
  .replace(/\/$/, "");

for (const name of HTML_NAMES) {
  const path = `${outdir}/${name}.html`;
  const html = await Bun.file(path).text();
  await Bun.write(
    path,
    html
      .replaceAll(EMITTED_PATTERN, "/")
      // The card and the page both need the origin. Each pattern is anchored on
      // its own attribute so no other link is rewritten; the source writes "./"
      // and EMITTED_PATTERN does not touch it.
      .replaceAll(
        'content="./public/og-card.png"',
        `content="${siteOrigin}/og-card.png"`,
      )
      .replaceAll(
        'content="/og-card.png"',
        `content="${siteOrigin}/og-card.png"`,
      )
      .replaceAll(
        'property="og:url" content="./"',
        `property="og:url" content="${siteOrigin}/"`,
      )
      .replaceAll(
        'rel="canonical" href="./"',
        `rel="canonical" href="${siteOrigin}/"`,
      ),
  );
}

/**
 * The two legal pages are pure markup: `PublicShell` and `InfoPage` hold no
 * state, effects or handlers. Rendering `PublicApp` here — the same component
 * the browser mounts — lets the deploy ship them with no script tag, which
 * removes the 264 KB React chunk and the hydration that made `/terms` score 58
 * on mobile Lighthouse.
 *
 * `renderToStaticMarkup` (not `renderToString`) because there is nothing to
 * hydrate: no data-reactroot attributes, no client entry.
 */
const prerenderLegal = (route: string): string | null => {
  if (route !== "/privacy" && route !== "/terms") return null;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [route] },
      createElement(PublicApp),
    ),
  );
};

const copyRoute = async (route: string, source: string): Promise<void> => {
  await Bun.$`mkdir -p ${outdir}${route}`;
  await Bun.write(
    `${outdir}${route}/index.html`,
    Bun.file(`${outdir}/${source}.html`),
  );
};

for (const route of publicAppRoutes) {
  const body = prerenderLegal(route);
  if (!body) {
    await copyRoute(route, "public-app");
    continue;
  }
  // Keep the head (CSS, meta, manifest) and drop every module script and
  // preload: the page is complete HTML, so nothing needs to boot.
  const shell = await Bun.file(`${outdir}/public-app.html`).text();
  // The title comes from the same `PAGES` entry that renders the page, so the
  // head and the body cannot disagree. The shell's own `<title>Milo</title>` is
  // replaced, not appended to: the page must ship exactly one.
  const title = `<title>Milo · ${PAGES[route.slice(1) as keyof typeof PAGES].title}</title>`;
  const shellHead = shell.slice(0, shell.indexOf("<body"));
  const head = shellHead.replace(/<title>[^<]*<\/title>/, title);
  await Bun.$`mkdir -p ${outdir}${route}`;
  await Bun.write(
    `${outdir}${route}/index.html`,
    `${head
      .replace(/<script\b[^>]*><\/script>/g, "")
      .replace(
        /<link rel="modulepreload"[^>]*>/g,
        "",
      )}<body>${body}</body></html>\n`,
  );
}
for (const route of workspaceAppRoutes) await copyRoute(route, "app");
// Vercel serves 404.html with status 404 for unknown paths. It comes from the
// public shell: the workspace shell's only catch-all is inside the signed-in
// branch, so a stranger would be told to sign in instead of "Page not found".
await Bun.write(`${outdir}/404.html`, Bun.file(`${outdir}/public-app.html`));

await Bun.write(`${outdir}/api/public-config`, JSON.stringify(browserConfig));

// Crawler files are build output, not repo files: the sitemap names the
// deployment's own origin, which only the build knows (same `siteOrigin` the
// canonical link uses). `/orders` and `/account` carry a signed-in workspace, so
// they stay out of the index.
await Bun.write(
  `${outdir}/robots.txt`,
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /orders",
    "Disallow: /account",
    "Disallow: /api/",
    ...(siteOrigin ? [`Sitemap: ${siteOrigin}/sitemap.xml`] : []),
    "",
  ].join("\n"),
);
if (siteOrigin)
  await Bun.write(
    `${outdir}/sitemap.xml`,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      // `/` plus every prerendered public route. `publicAppRoutes` is the same
      // array the prerender loop above uses, so the sitemap cannot list a page
      // that is not built, or miss one that is.
      ...[...new Set(["/", ...publicAppRoutes])].map(
        (route) => `  <url><loc>${siteOrigin}${route}</loc></url>`,
      ),
      "</urlset>",
      "",
    ].join("\n"),
  );

// RFC 9116. `Contact` and `Expires` are the only required fields; the RFC wants
// an ISO 8601 datetime with a timezone and recommends at most a year out. Both
// are computed here, so the file can never ship already stale.
const securityContact = (await Bun.file("SECURITY.md").text())
  .match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]
  // The address sits inside a sentence, so strip the full stop: a `mailto:` with
  // a trailing period is a different, wrong address.
  .replace(/\.$/, "");
if (securityContact) {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  await Bun.$`mkdir -p ${outdir}/.well-known`;
  await Bun.write(
    `${outdir}/.well-known/security.txt`,
    [
      `Contact: mailto:${securityContact}`,
      `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "z")}`,
      ...(siteOrigin
        ? [`Canonical: ${siteOrigin}/.well-known/security.txt`]
        : []),
      "Preferred-Languages: en",
      "",
    ].join("\n"),
  );
}

// Which commit a live artifact came from. A git-connected build gets the commit
// from Vercel; a local CLI upload has no such variable and falls back to the
// checkout. Only TRACKED changes count as dirty: an untracked scratch file cannot
// alter the build, and counting it made every deploy look unreproducible.
const git = (args: string[]) => {
  const run = Bun.spawnSync(["git", ...args]);
  return run.exitCode === 0 ? run.stdout.toString().trim() : "";
};
const HEAD = ["rev-parse", "HEAD"];
const BRANCH = ["branch", "--show-current"];
const env = process.env;
await Bun.write(
  `${outdir}/deploy.json`,
  `${JSON.stringify(
    {
      // VERCEL_GIT_* on Vercel, GITHUB_* on Actions, else the checkout. CI checks
      // out a detached HEAD, where `git branch --show-current` prints nothing, so
      // without GITHUB_REF_NAME every CI build stamped `branch: null`.
      commit: env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || git(HEAD) || null,
      branch:
        env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || git(BRANCH) || null,
      dirty: git(["status", "--porcelain", "--untracked-files=no"]) !== "",
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

// CycloneDX for the shipped dependency tree. `npm sbom` needs a
// package-lock.json and this repo has none, `bun pm licenses` lists licences but
// emits no document, and the lockfile already carries name, version and sha512
// for every package, so the SBOM is a projection of a file we ship.
const lock = Bun.JSONC.parse(await Bun.file("bun.lock").text()) as {
  packages: Record<string, [string, string, Record<string, unknown>, string?]>;
};
await Bun.write(
  `${outdir}/sbom.cdx.json`,
  `${JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: { type: "application", name: "milo" },
      },
      components: Object.entries(lock.packages).map(([name, entry]) => {
        const [ref, , , integrity] = entry;
        const version = ref.slice(ref.lastIndexOf("@") + 1);
        return {
          type: "library",
          name,
          version,
          purl: `pkg:npm/${name.replace("@", "%40")}@${version}`,
          ...(integrity?.startsWith("sha512-")
            ? { hashes: [{ alg: "SHA-512", content: integrity.slice(7) }] }
            : {}),
        };
      }),
    },
    null,
    2,
  )}\n`,
);

const publicDirectory = "apps/web/public";
const QA_ONLY = [/^qa-/];

for (const path of new Bun.Glob("**/*").scanSync(publicDirectory)) {
  if (QA_ONLY.some((pattern) => pattern.test(path))) continue;
  await Bun.write(`${outdir}/${path}`, Bun.file(`${publicDirectory}/${path}`));
}

// ---- Content-Security-Policy ---------------------------------------------
// `vercel.json` ships a policy written with wildcard origins and a placeholder
// report host, so the file is valid on its own. The built copy substitutes the
// real origins this deployment was configured with, taken from the same
// `publicConfig()` the browser reads, so the policy cannot drift from reality.
// The rewrite itself lives in `packages/backend/src/public-config.ts` so that
// `scripts/public-config.test.ts` can prove its invariants without a build.
const manifestPath = `${outdir}/vercel.json`;
const manifest = await Bun.file(manifestPath).json();
// A build with no deployment configured (CI, a fresh clone) keeps the shipped
// policy as is; narrowing needs the auth origin to name the report endpoint.
if (browserConfig.betterAuthUrl)
  narrowCsp(manifest, browserConfig, Boolean(process.env.PROVER_SERVER_URI));
else console.warn("CSP left as shipped: no BETTER_AUTH_URL configured.");
await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Cloudflare reads `_headers`/`_redirects` from the asset directory. Both are
// generated from the manifest just narrowed above, so the policy the site ships
// has one source and cannot drift into a hand-maintained second copy. They are
// build output, not repo files: the CSP origins differ per deployment.
await Bun.write(`${outdir}/_headers`, cloudflareHeaders(manifest, zkVersion));
await Bun.write(`${outdir}/_redirects`, cloudflareRedirects(manifest));

// Artifacts are addressed by circuit name alone, so replacing them in place
// would silently swap the keys an already-deployed order was created with.
// Emit a second, content-addressed copy under the compile receipt's source hash
// so an old order can keep asking for the set it was deployed against.
// `zkSource` and `zkVersion` are computed above, before Bun.build, because the
// client bundle embeds the version as a constant.
for (const directory of ["keys", "zkir"] as const) {
  for (const path of new Bun.Glob("*").scanSync(`${zkSource}/${directory}`)) {
    const file = Bun.file(`${zkSource}/${directory}/${path}`);
    await Bun.write(`${outdir}/zk/${directory}/${path}`, file);
    await Bun.write(`${outdir}/zk/${zkVersion}/${directory}/${path}`, file);
  }
}

const emittedScripts = await Promise.all(
  result.outputs
    .filter((output) => output.path.endsWith(".js"))
    .map((output) => output.text()),
);

const referenced = new Set(
  emittedScripts.flatMap((text) =>
    [...text.matchAll(/[A-Za-z0-9_-]+\.wasm/g)].map((match) => match[0]),
  ),
);

const pruned: string[] = [];

for (const output of result.outputs) {
  // A wasm nothing references is dead weight; so is the 0-byte JS chunk Bun's
  // splitter emits for a fully tree-shaken module. Same loop, one condition.
  const name = output.path.split("/").pop() as string;
  const empty = output.path.endsWith(".js") && output.size === 0;
  if (!empty && !output.path.endsWith(".wasm")) continue;
  if (!empty && referenced.has(name)) continue;
  await Bun.$`rm -f ${output.path}`;
  if (empty) pruned.push(name);
}

/**
 * Bun injects a `<script src>` into an HTML entrypoint even when that entry
 * imports nothing, and emits a 0-byte chunk for it. The prune above deletes the
 * chunk, so the tag would point at a file that is not there: a 404 and a
 * console error on every load. Proven with a two-line repro — a script-less
 * HTML entry yields `plain-7tsh300k.js` at 0 bytes and the HTML still names it.
 *
 * Drop the tag with the file. This is what lets an entry with no script of its
 * own build correctly, which a no-JS landing needs.
 */
const dead = pruned.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
if (dead.length) {
  const tag = new RegExp(
    `<script\\b[^>]*src="/[^"]*(?:${dead.join("|")})"[^>]*></script>`,
    "g",
  );
  for (const name of HTML_NAMES) {
    const path = `${outdir}/${name}.html`;
    await Bun.write(path, (await Bun.file(path).text()).replace(tag, ""));
  }
}

/**
 * Every script an emitted page names must exist. A missing one is a 404 and a
 * console error on every load, and nothing else in the build notices: the tag
 * is valid HTML, the chunk was real when it was written, and only the pairing
 * is broken. This is the check that would have caught the dangling reference
 * above, so it is a build failure rather than a comment.
 */
for (const path of new Bun.Glob("**/*.html").scanSync(outdir)) {
  const html = await Bun.file(`${outdir}/${path}`).text();
  for (const [, src] of html.matchAll(/<script\b[^>]*\ssrc="(\/[^"]+)"/g))
    if (!(await Bun.file(`${outdir}${src}`).exists()))
      throw new Error(
        `${path} references ${src}, which the build did not emit.`,
      );
}
