import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

export function createMarketDatabasePool(config, {
  PoolClass = pg.Pool,
  attach = attachDatabasePool,
  logger = console,
} = {}) {
  if (config.type !== "postgres" || !config.isConfigured) return null;

  const pool = new PoolClass({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  attach(pool);
  pool.on("error", (error) => {
    logger.error?.(`[Market] databasePoolError code=${error.code || "DATABASE_ERROR"}`);
  });
  return pool;
}
