import migrate from "node-pg-migrate";
import { MigrationDirection } from "node-pg-migrate/dist/types";
import { resolve } from "path";
import { client, clientConfig } from "./config";

async function setupDb() {
  console.log("Running DB migrations");
  await migrate({
    databaseUrl: `postgresql://${clientConfig.user}:${clientConfig.password}@${clientConfig.host}:${clientConfig.port}/${clientConfig.database}`,
    count: Infinity,
    createMigrationsSchema: true,
    createSchema: true,
    dir: resolve(__dirname, "../../migrations"),
    direction: "up" as MigrationDirection,
    ignorePattern: ".*.ts",
    logger: console,
    migrationsTable: "migrations",
    verbose: true,
  });
  console.log("Done running migrations");
}

export const dbMigrationDone = setupDb();
