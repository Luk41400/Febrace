import { createDataForSeoMarketProvider } from "./dataforseo-market-provider.js";
import { createPostgresMarketProvider } from "./postgres-market-provider.js";

export function createMarketProvider(config, {
  pool,
  createDataForSeo = createDataForSeoMarketProvider,
  createPostgres = createPostgresMarketProvider,
} = {}) {
  if (config.type === "postgres") return createPostgres({ pool });
  return config.isConfigured ? createDataForSeo(config) : null;
}
