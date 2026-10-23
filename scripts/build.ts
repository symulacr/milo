import {
  publicAppPrefixes,
  publicAppRoutes,
  workspaceAppPrefixes,
  workspaceAppRoutes,
} from "../apps/web/src/route-table";
import { publicConfig } from "../packages/backend/src/public-config";

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

for (const name of HTML_NAMES) {
  const path = `${outdir}/${name}.html`;
  const html = await Bun.file(path).text();
  await Bun.write(path, html.replaceAll(EMITTED_PATTERN, "/"));
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

await Bun.write(`${outdir}/api/public-config`, JSON.stringify(browserConfig));
await Bun.write(
  `${outdir}/_headers`,
  "/api/public-config\n  Content-Type: application/json\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n",
);

const publicDirectory = "apps/web/public";
const QA_ONLY = [/^qa-/, /^samples\/qa-/, /^qa-build\//];

for (const path of new Bun.Glob("**/*").scanSync(publicDirectory)) {
  if (QA_ONLY.some((pattern) => pattern.test(path))) continue;
  await Bun.write(`${outdir}/${path}`, Bun.file(`${publicDirectory}/${path}`));
}

const redirects = [
  ...publicAppRoutes.map((route) => `${route} /public-app.html 200`),
  ...publicAppPrefixes.map((prefix) => `${prefix}/* /public-app.html 200`),
  ...workspaceAppPrefixes.map((prefix) => `${prefix}/* /app.html 200`),
  "/* /app.html 200",
].join("\n");
await Bun.write(`${outdir}/_redirects`, `${redirects}\n`);

for (const output of result.outputs) {
  if (!output.path.endsWith(".js")) continue;
  const bytes = new Uint8Array(await output.arrayBuffer()).length;
  console.log(`bundle: ${output.path.split("/").pop()} ${bytes} bytes (raw)`);
}
