import app from "../apps/web/app.html";
import landing from "../apps/web/index.html";
import publicApp from "../apps/web/public-app.html";
import { publicConfig, publicConfigResponse } from "./public-config";

const browserConfig = publicConfig(process.env);

const publicRoutes = Object.fromEntries(
  Array.from(new Bun.Glob("**/*").scanSync("apps/web/public")).map((path) => [
    `/${path}`,
    Bun.file(`apps/web/public/${path}`),
  ]),
);
// Lean public SPA routes (01 §7.4); everything else is the workspace app.
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
    "/m/*": publicApp,
    "/quotes/*": app,
    "/orders/*": app,
    "/merchant/*": app,
    "/operator/*": app,
    "/__qa/axe.js": new Response(Bun.file("node_modules/axe-core/axe.min.js"), {
      headers: { "Content-Type": "text/javascript" },
    }),
    "/*": app,
  },
});
