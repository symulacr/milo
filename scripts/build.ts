import { publicConfig } from "./public-config";

const browserConfig = publicConfig(process.env);

// Lean public SPA (01 §7.4): no auth/wallet/backend/simulator code.
const publicAppRoutes = [
  "/demo",
  "/sign-in",
  "/how-it-works",
  "/privacy",
  "/terms",
  "/pilot",
];
const workspaceAppRoutes = [
  "/orders",
  "/merchant/orders",
  "/merchant/quotes/new",
  "/operator/cases",
  "/account",
  "/connections",
];
const outdir = "dist";
const buildEntrypoints = ".tools/build-entrypoints";

await Bun.$`rm -rf ${outdir}`;
await Bun.$`rm -rf ${buildEntrypoints}`;
await Bun.$`mkdir -p ${buildEntrypoints}`;

const prepareHtmlEntrypoint = async (name: "index" | "app" | "public-app") => {
  const source = await Bun.file(`apps/web/${name}.html`).text();
  await Bun.write(
    `${buildEntrypoints}/${name}.html`,
    source
      .replaceAll('href="./src/', 'href="../../apps/web/src/')
      .replaceAll('src="./src/', 'src="../../apps/web/src/')
      .replaceAll('href="./public/', 'href="../../apps/web/public/')
      .replaceAll('src="./public/', 'src="../../apps/web/public/'),
  );
};

await Promise.all([
  prepareHtmlEntrypoint("index"),
  prepareHtmlEntrypoint("app"),
  prepareHtmlEntrypoint("public-app"),
]);
const result = await Bun.build({
  entrypoints: [
    `${buildEntrypoints}/index.html`,
    `${buildEntrypoints}/app.html`,
    `${buildEntrypoints}/public-app.html`,
  ],
  outdir,
  root: buildEntrypoints,
  publicPath: "/",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
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

for (const route of publicAppRoutes) {
  await Bun.$`mkdir -p ${outdir}${route}`;
  await Bun.write(
    `${outdir}${route}/index.html`,
    Bun.file(`${outdir}/public-app.html`),
  );
}
for (const route of workspaceAppRoutes) {
  await Bun.$`mkdir -p ${outdir}${route}`;
  await Bun.write(
    `${outdir}${route}/index.html`,
    Bun.file(`${outdir}/app.html`),
  );
}

await Bun.write(`${outdir}/api/public-config`, JSON.stringify(browserConfig));
await Bun.write(
  `${outdir}/_headers`,
  "/api/public-config\n  Content-Type: application/json\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n",
);

const publicDirectory = "apps/web/public";
for (const path of new Bun.Glob("**/*").scanSync(publicDirectory)) {
  await Bun.write(`${outdir}/${path}`, Bun.file(`${publicDirectory}/${path}`));
}

// §7.4 bundle inventory: report emitted JS so lazy/public chunks stay visible.
for (const output of result.outputs) {
  if (output.path.endsWith(".js")) {
    const bytes = new Uint8Array(await output.arrayBuffer()).length;
    console.log(`bundle: ${output.path.split("/").pop()} ${bytes} bytes (raw)`);
  }
}
