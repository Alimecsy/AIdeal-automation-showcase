import { defineConfig } from "prisma/config";

// Prisma loads this config for non-migration commands too. The inert fallback
// keeps those commands independent of app database credentials while ensuring
// a raw Prisma migration command cannot fall back to DATABASE_URL or DIRECT_URL.
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgresql://migration-config-required@127.0.0.1:1/migration_config_required";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: migrationUrl,
  },
});
