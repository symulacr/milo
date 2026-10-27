import app from "../apps/web/app.html";
import landing from "../apps/web/index.html";
import publicApp from "../apps/web/public-app.html";
import {
  legacyRedirects,
  publicAppPrefixes,
  publicAppRoutes,
  workspaceAppPrefixes,
  workspaceAppRoutes,
} from "../apps/web/src/route-table";
import {
  publicConfig,
  publicConfigResponse,
} from "../packages/backend/src/public-config";

const browserConfig = publicConfig(process.env);

const publicDirectory = "apps/web/public";

const zkDirectory = "packages/contract/generated";

const publicRoutes = Object.fromEntries(
  Array.from(new Bun.Glob("**/*").scanSync(publicDirectory)).map((path) => [
    `/${path}`,
    Bun.file(`${publicDirectory}/${path}`),
  ]),
);

const zkVersion = (
  (await Bun.file(`${zkDirectory}/compile-receipt.json`).json()) as {
    sourceSha256: string;
  }
).sourceSha256.slice(0, 16);

const zkRoutes = Object.fromEntries(
  (["keys", "zkir"] as const).flatMap((directory) =>
    Array.from(
      new Bun.Glob("*").scanSync(`${zkDirectory}/${directory}`),
    ).flatMap((path) => {
      const file = Bun.file(`${zkDirectory}/${directory}/${path}`);
      return [
        [`/zk/${directory}/${path}`, file],
        [`/zk/${zkVersion}/${directory}/${path}`, file],
      ];
    }),
  ),
);

const byRoute = (routes: readonly string[], value: unknown) =>
  Object.fromEntries(routes.map((route) => [route, value]));

const byPrefix = (prefixes: readonly string[], value: unknown) =>
  Object.fromEntries(prefixes.map((prefix) => [`${prefix}/*`, value]));

const legacy = Object.fromEntries(
  legacyRedirects.map(([from, to]) => [
    from,
    (request: Request & { params?: Record<string, string> }) => {
      const url = new URL(request.url);
      let path: string = to;
      for (const [key, value] of Object.entries(request.params ?? {}))
        path = path.replace(`:${key}`, value);
      const target = new URL(path, url);
      for (const [key, value] of url.searchParams)
        if (!target.searchParams.has(key)) target.searchParams.set(key, value);
      return Response.redirect(target.toString(), 301);
    },
  ]),
);

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT) || 3000,
  development: true,
  routes: {
    ...publicRoutes,
    ...zkRoutes,
    "/": landing,
    "/api/public-config": (request) =>
      publicConfigResponse(request, browserConfig),
    ...byRoute(publicAppRoutes, publicApp),
    ...byRoute(workspaceAppRoutes, app),
    ...byPrefix(publicAppPrefixes, publicApp),
    ...byPrefix(workspaceAppPrefixes, app),
    ...legacy,
    "/*": app,
  },
});
