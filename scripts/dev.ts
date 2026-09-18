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

const publicRoutes = Object.fromEntries(
  Array.from(new Bun.Glob("**/*").scanSync("apps/web/public")).map((path) => [
    `/${path}`,
    Bun.file(`apps/web/public/${path}`),
  ]),
);

Bun.serve({
  hostname: "0.0.0.0",
  port: 3000,
  development: true,
  routes: {
    ...publicRoutes,
    "/": landing,
    "/api/public-config": (request) =>
      publicConfigResponse(request, browserConfig),
    ...Object.fromEntries(publicAppRoutes.map((route) => [route, publicApp])),
    ...Object.fromEntries(workspaceAppRoutes.map((route) => [route, app])),
    ...Object.fromEntries(
      publicAppPrefixes.map((prefix) => [`${prefix}/*`, publicApp]),
    ),
    ...Object.fromEntries(
      workspaceAppPrefixes.map((prefix) => [`${prefix}/*`, app]),
    ),
    "/__qa/axe.js": new Response(Bun.file("node_modules/axe-core/axe.min.js"), {
      headers: { "Content-Type": "text/javascript" },
    }),
    "/*": app,
  },
});
