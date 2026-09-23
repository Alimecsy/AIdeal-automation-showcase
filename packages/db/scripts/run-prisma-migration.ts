import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type MigrationMode = "dev" | "deploy";
type MigrationProfile = "local" | "ci" | "disposable";

type MigrationRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<number>;

export type MigrationRunOptions = {
  mode: MigrationMode;
  env?: NodeJS.ProcessEnv;
  run?: MigrationRunner;
  write?: (line: string) => void;
};

export type VerifiedMigrationTarget = {
  profile: MigrationProfile;
  host: string;
  port: string;
  database: string;
  tls: boolean;
  fingerprint: string;
};

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message: string): never {
  throw new Error(`Migration target rejected: ${message}`);
}

function getProfile(value: string | undefined): MigrationProfile {
  if (value === "local" || value === "ci" || value === "disposable")
    return value;
  fail("AIDEAL_MIGRATION_TARGET must be local, ci, or disposable");
}

function fingerprint(host: string, port: string, database: string) {
  return createHash("sha256")
    .update(`${host}\0${port}\0${database}`)
    .digest("hex")
    .slice(0, 12);
}

function targetFromEnvironment(
  env: NodeJS.ProcessEnv,
): VerifiedMigrationTarget {
  const profile = getProfile(env.AIDEAL_MIGRATION_TARGET);
  const rawUrl = env.MIGRATION_DATABASE_URL;
  if (!rawUrl) fail("MIGRATION_DATABASE_URL is required");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("MIGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail("MIGRATION_DATABASE_URL must use a PostgreSQL protocol");
  }

  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const port = url.port || "5432";
  if (!host || !database)
    fail("MIGRATION_DATABASE_URL must identify a host and database");

  if (profile === "local") {
    if (
      !new Set(["localhost", "127.0.0.1", "::1"]).has(host) ||
      database !== "aideal_local"
    ) {
      fail(
        "local migrations require a loopback host and the aideal_local database",
      );
    }
  } else {
    const expectedHost = env.AIDEAL_MIGRATION_EXPECTED_HOST?.toLowerCase();
    const expectedDatabase = env.AIDEAL_MIGRATION_EXPECTED_DATABASE;
    if (!expectedHost || !expectedDatabase) {
      fail(
        "ci and disposable migrations require expected host and database identity",
      );
    }
    if (host !== expectedHost || database !== expectedDatabase) {
      fail(
        "connection target does not match the expected host and database identity",
      );
    }
  }

  return {
    profile,
    host,
    port,
    database,
    tls: ["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    ),
    fingerprint: fingerprint(host, port, database),
  };
}

function ensureModeIsAllowed(
  mode: MigrationMode,
  target: VerifiedMigrationTarget,
  env: NodeJS.ProcessEnv,
) {
  if (mode === "dev" && target.profile !== "local") {
    fail("migrate dev is allowed only for the local profile");
  }
  if (
    mode === "deploy" &&
    env.AIDEAL_MIGRATION_APPROVAL !== target.fingerprint
  ) {
    fail(`deploy requires AIDEAL_MIGRATION_APPROVAL=${target.fingerprint}`);
  }
}

function sanitizedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment = { ...env };
  delete childEnvironment.DATABASE_URL;
  delete childEnvironment.DIRECT_URL;
  return childEnvironment;
}

function spawnPrisma(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun(code ?? 1));
  });
}

export async function runPrismaMigration(
  options: MigrationRunOptions,
): Promise<VerifiedMigrationTarget> {
  const env = options.env ?? process.env;
  const target = targetFromEnvironment(env);
  ensureModeIsAllowed(options.mode, target, env);

  (options.write ?? console.log)(
    `migration-target verified profile=${target.profile} host=${target.host} port=${target.port} database=${target.database} tls=${target.tls} fingerprint=${target.fingerprint}`,
  );

  const exitCode = await (options.run ?? spawnPrisma)(
    "pnpm",
    ["exec", "prisma", "migrate", options.mode, "--config", "prisma.config.ts"],
    { cwd: packageDirectory, env: sanitizedEnvironment(env) },
  );
  if (exitCode !== 0)
    throw new Error(
      `Prisma migration command failed with exit code ${exitCode}`,
    );

  return target;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "deploy") fail("mode must be dev or deploy");
  await runPrismaMigration({ mode });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Migration target rejected",
    );
    process.exitCode = 1;
  });
}
