/**
 * Layer boundary: nothing under a package's `src/` may import from `convex/`.
 *
 * `convex/` is the deployed backend; the `packages` src trees are the pure
 * layer that must stay runnable without a Convex deployment. The inversion
 * was 5 edges from `packages/backend/src/` and Wave 2A removed the two
 * offending files, so the rule is installed to hold it at zero rather than to
 * report it.
 *
 * `from.path` requires the second path segment to be `src`, so the 27
 * `packages/backend/test/` -> `convex/` edges stay legal: tests are allowed to
 * exercise the live handlers, and they are not shipped.
 *
 * dependency-cruiser 18.5.0 refuses `typescript >= 7`, so it and any future
 * TypeScript 7 bump are mutually exclusive. Re-pin or replace before bumping.
 */
module.exports = {
  forbidden: [
    {
      name: "no-backend-to-convex",
      severity: "error",
      comment:
        "packages/*/src/ must not import convex/. Test directories may: they exercise the handlers without shipping them.",
      from: { path: "^packages/[^/]+/src/" },
      to: { path: "^convex/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)node_modules/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "module"],
      mainFiles: ["index", "main"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
    },
  },
};
