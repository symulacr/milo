import app from "../apps/web/app.html";
import landing from "../apps/web/index.html";
import publicApp from "../apps/web/public-app.html";
import {
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

const publicRoutes = Object.fromEntries(
  Array.from(new Bun.Glob("**/*").scanSync(publicDirectory)).map((path) => [
    `/${path}`,
    Bun.file(`${publicDirectory}/${path}`),
  ]),
);

const byRoute = (routes: readonly string[], value: unknown) =>
  Object.fromEntries(routes.map((route) => [route, value]));

const byPrefix = (prefixes: readonly string[], value: unknown) =>
  Object.fromEntries(prefixes.map((prefix) => [`${prefix}/*`, value]));

Bun.serve({
  hostname: "0.0.0.0",
  port: 3000,
  development: true,
  routes: {
    ...publicRoutes,
    "/": landing,
    "/api/public-config": (request) =>
      publicConfigResponse(request, browserConfig),
    ...byRoute(publicAppRoutes, publicApp),
    ...byRoute(workspaceAppRoutes, app),
    ...byPrefix(publicAppPrefixes, publicApp),
    ...byPrefix(workspaceAppPrefixes, app),
    "/__qa/axe.js": new Response(Bun.file("node_modules/axe-core/axe.min.js"), {
      headers: { "Content-Type": "text/javascript" },
    }),
    "/*": app,
  },
});
