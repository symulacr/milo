import tailwind from "bun-plugin-tailwind";
import {
  publicAppRoutes,
  workspaceAppRoutes,
} from "../apps/web/src/route-table";
import { narrowCsp, publicConfig } from "../packages/backend/src/public-config";
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

const result = await Bun.build({
  entrypoints: HTML_NAMES.map((name) => `${buildEntrypoints}/${name}.html`),
  outdir,
  root: buildEntrypoints,
  publicPath: "/",
  minify: true,
  plugins: [tailwind, wasmBindings()],
  define: { "process.env.NODE_ENV": '"production"' },
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
const siteOrigin = (process.env.SITE_URL ?? "").replace(/\/$/, "");

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

const copyRoute = async (route: string, source: string): Promise<void> => {
  await Bun.$`mkdir -p ${outdir}${route}`;
  await Bun.write(
    `${outdir}${route}/index.html`,
    Bun.file(`${outdir}/${source}.html`),
  );
};

for (const route of publicAppRoutes) await copyRoute(route, "public-app");
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
      `  <url><loc>${siteOrigin}/</loc></url>`,
      "</urlset>",
      "",
    ].join("\n"),
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

const zkSource = "packages/contract/generated";

for (const directory of ["keys", "zkir"] as const) {
  for (const path of new Bun.Glob("*").scanSync(`${zkSource}/${directory}`)) {
    await Bun.write(
      `${outdir}/zk/${directory}/${path}`,
      Bun.file(`${zkSource}/${directory}/${path}`),
    );
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

for (const output of result.outputs) {
  // A wasm nothing references is dead weight; so is the 0-byte JS chunk Bun's
  // splitter emits for a fully tree-shaken module. Same loop, one condition.
  const name = output.path.split("/").pop() as string;
  const empty = output.path.endsWith(".js") && output.size === 0;
  if (!empty && !output.path.endsWith(".wasm")) continue;
  if (!empty && referenced.has(name)) continue;
  await Bun.$`rm -f ${output.path}`;
}
