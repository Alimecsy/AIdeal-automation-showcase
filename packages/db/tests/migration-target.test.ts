import assert from "node:assert/strict";
import { test } from "node:test";
import { runPrismaMigration } from "../scripts/run-prisma-migration.js";

test("deploy verifies an explicit disposable target and strips application database URLs", async () => {
  const secretUrl =
    "postgresql://migration_user:super-secret@branch.example.test:5432/aideal_disposable?sslmode=require";
  const calls: Array<{
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }> = [];
  const output: string[] = [];

  const result = await runPrismaMigration({
    mode: "deploy",
    env: {
      AIDEAL_MIGRATION_TARGET: "disposable",
      CI: "true",
      MIGRATION_DATABASE_URL: secretUrl,
      AIDEAL_MIGRATION_EXPECTED_HOST: "branch.example.test",
      AIDEAL_MIGRATION_EXPECTED_DATABASE: "aideal_disposable",
      AIDEAL_MIGRATION_APPROVAL: "2e39c58f773f",
      DATABASE_URL: "postgresql://app:app-secret@app.example.test/aideal",
      DIRECT_URL:
        "postgresql://direct:direct-secret@direct.example.test/aideal",
    },
    run: async (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return 0;
    },
    write: (line) => output.push(line),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "pnpm");
  assert.deepEqual(calls[0]?.args, [
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--config",
    "prisma.config.ts",
  ]);
  assert.equal(calls[0]?.env.MIGRATION_DATABASE_URL, secretUrl);
  assert.equal(calls[0]?.env.DATABASE_URL, undefined);
  assert.equal(calls[0]?.env.DIRECT_URL, undefined);
  assert.equal(output.length, 1);
  assert.match(
    output[0] ?? "",
    /^migration-target verified profile=disposable host=branch\.example\.test port=5432 database=aideal_disposable tls=true fingerprint=[a-f0-9]{12}$/,
  );
  assert.equal(output.join("\n").includes("super-secret"), false);
  assert.equal(result.fingerprint.length, 12);
});

test("rejects a configured DIRECT_URL when the dedicated migration URL is absent", async () => {
  let invoked = false;

  await assert.rejects(
    runPrismaMigration({
      mode: "deploy",
      env: {
        AIDEAL_MIGRATION_TARGET: "ci",
        CI: "true",
        DIRECT_URL:
          "postgresql://configured:secret@configured.example.test/aideal",
        DATABASE_URL: "postgresql://app:secret@app.example.test/aideal",
      },
      run: async () => {
        invoked = true;
        return 0;
      },
    }),
    /MIGRATION_DATABASE_URL is required/,
  );

  assert.equal(invoked, false);
});

test("rejects a mismatched disposable identity without exposing URL credentials", async () => {
  const secretUrl =
    "postgresql://migration_user:never-log-this@branch.example.test:5432/aideal_wrong?sslmode=require";
  let invoked = false;

  await assert.rejects(
    runPrismaMigration({
      mode: "deploy",
      env: {
        AIDEAL_MIGRATION_TARGET: "disposable",
        CI: "true",
        MIGRATION_DATABASE_URL: secretUrl,
        AIDEAL_MIGRATION_EXPECTED_HOST: "branch.example.test",
        AIDEAL_MIGRATION_EXPECTED_DATABASE: "aideal_expected",
      },
      run: async () => {
        invoked = true;
        return 0;
      },
    }),
    (error: Error) => !error.message.includes("never-log-this"),
  );

  assert.equal(invoked, false);
});

test("permits migrate dev only for the reserved local database", async () => {
  const calls: string[][] = [];

  await runPrismaMigration({
    mode: "dev",
    env: {
      AIDEAL_MIGRATION_TARGET: "local",
      MIGRATION_DATABASE_URL:
        "postgresql://local:secret@127.0.0.1/aideal_local",
    },
    run: async (_command, args) => {
      calls.push(args);
      return 0;
    },
    write: () => undefined,
  });

  assert.deepEqual(calls, [
    ["exec", "prisma", "migrate", "dev", "--config", "prisma.config.ts"],
  ]);
});

test("requires a reviewed fingerprint for non-CI deploys", async () => {
  let invoked = false;

  await assert.rejects(
    runPrismaMigration({
      mode: "deploy",
      env: {
        AIDEAL_MIGRATION_TARGET: "local",
        MIGRATION_DATABASE_URL:
          "postgresql://local:secret@localhost/aideal_local",
      },
      run: async () => {
        invoked = true;
        return 0;
      },
    }),
    /AIDEAL_MIGRATION_APPROVAL=[a-f0-9]{12}/,
  );

  assert.equal(invoked, false);
});

test("requires a reviewed fingerprint for CI deploys", async () => {
  let invoked = false;

  await assert.rejects(
    runPrismaMigration({
      mode: "deploy",
      env: {
        AIDEAL_MIGRATION_TARGET: "ci",
        CI: "true",
        MIGRATION_DATABASE_URL:
          "postgresql://ci:secret@ci.example.test/aideal_ci",
        AIDEAL_MIGRATION_EXPECTED_HOST: "ci.example.test",
        AIDEAL_MIGRATION_EXPECTED_DATABASE: "aideal_ci",
      },
      run: async () => {
        invoked = true;
        return 0;
      },
    }),
    /AIDEAL_MIGRATION_APPROVAL=[a-f0-9]{12}/,
  );

  assert.equal(invoked, false);
});

test("rejects unsupported profiles and non-local migrate dev before Prisma starts", async () => {
  let invoked = false;
  const run = async () => {
    invoked = true;
    return 0;
  };

  await assert.rejects(
    runPrismaMigration({
      mode: "deploy",
      env: {
        AIDEAL_MIGRATION_TARGET: "production",
        MIGRATION_DATABASE_URL: "postgresql://x:y@host/db",
      },
      run,
    }),
    /must be local, ci, or disposable/,
  );
  await assert.rejects(
    runPrismaMigration({
      mode: "dev",
      env: {
        AIDEAL_MIGRATION_TARGET: "ci",
        MIGRATION_DATABASE_URL: "postgresql://x:y@ci.example.test/aideal_ci",
        AIDEAL_MIGRATION_EXPECTED_HOST: "ci.example.test",
        AIDEAL_MIGRATION_EXPECTED_DATABASE: "aideal_ci",
      },
      run,
    }),
    /migrate dev is allowed only for the local profile/,
  );

  assert.equal(invoked, false);
});
