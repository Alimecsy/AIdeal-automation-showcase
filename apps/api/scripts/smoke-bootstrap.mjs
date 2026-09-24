/**
 * Boots the compiled application graph and asserts its routes.
 *
 * This runs against `dist`, not the TypeScript sources, and that is the whole
 * point. Nest resolves constructor dependencies from the `design:paramtypes`
 * metadata that `tsc` emits under `emitDecoratorMetadata`. The unit suite runs
 * on tsx, whose esbuild transform does not emit that metadata, so under it Nest
 * injects `undefined` for an unresolvable dependency instead of failing. A
 * module that applies a guard without importing the module providing its
 * dependency therefore typechecks, passes every unit test, and then fails on
 * the first real start. Booting the compiled output is the only place that
 * class of defect can be caught before deployment.
 *
 * It contacts nothing: `init()` resolves providers and registers routes without
 * opening a socket, and the database, storage, and cache clients built during
 * construction all connect lazily.
 */
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/modules/app.module.js";

// One route per boundary that a broken module graph would silently remove:
// health, the authenticated console, the public applicant surface, and the
// worker's single privileged lifecycle command.
const REQUIRED_ROUTES = [
  "GET /api/health",
  "GET /api/organizations/current",
  "GET /api/intake-forms",
  "GET /api/deal-types",
  "GET /api/public/intake-forms/:slug",
  "POST /api/public/intake-sessions/:token/submit",
  "POST /api/public/intake-sessions/:token/uploads/presign",
  "GET /api/notifications",
  "GET /api/usage/summary",
  "POST /api/internal/deals/:dealId/review-ready",
];

function registeredRoutes(app) {
  const instance = app.getHttpAdapter().getInstance();
  const stack = instance?.router?.stack ?? instance?._router?.stack ?? [];

  return new Set(
    stack.flatMap((layer) => {
      const path = layer?.route?.path;
      if (!path) return [];
      return Object.keys(layer.route.methods ?? {}).map(
        (method) => `${method.toUpperCase()} ${path}`,
      );
    }),
  );
}

async function main() {
  // `abortOnError: false` turns a resolution failure into a thrown error
  // rather than a silent `process.exit(1)`, so the reason reaches the log.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  await app.init();

  const routes = registeredRoutes(app);
  assert.notEqual(
    routes.size,
    0,
    "no routes were registered; the route table could not be read",
  );

  const missing = REQUIRED_ROUTES.filter((route) => !routes.has(route));
  assert.deepEqual(
    missing,
    [],
    `routes missing from the booted application:\n  ${missing.join("\n  ")}`,
  );

  await app.close();
  console.log(
    JSON.stringify({
      ok: true,
      smoke: "api-bootstrap",
      routesRegistered: routes.size,
      routesAsserted: REQUIRED_ROUTES.length,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({ ok: false, smoke: "api-bootstrap", error: error?.message }),
  );
  console.error(error);
  process.exit(1);
});
