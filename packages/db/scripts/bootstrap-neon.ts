import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { parseEnv } from "@aideal/env";

const env = parseEnv();

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(env.DATABASE_URL);
const scriptPath = resolve(process.cwd(), "prisma", "init.sql");
const script = readFileSync(scriptPath, "utf8");

function splitStatements(input: string): string[] {
  return input
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);
}

async function main() {
  const statements = splitStatements(script);

  for (const [index, statement] of statements.entries()) {
    try {
      await sql.query(statement);
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            statementIndex: index,
            statementPreview: statement.slice(0, 240),
          },
          null,
          2,
        ),
      );

      throw error;
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      statementsApplied: statements.length,
    }),
  );
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
