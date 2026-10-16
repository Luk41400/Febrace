import { MarketProviderError } from "./dataforseo-market-provider.js";
import { normalizeMarketQuery } from "../js/domain/market-relevance.js";

export async function runMarketSearch({ provider, config, logger = console, query, refresh = false, signal }) {
  const normalizedQuery = normalizeMarketQuery(query);
  if (normalizedQuery.length < 3) {
    throw new MarketProviderError("Informe um produto para pesquisar.", {
      code: "INVALID_MARKET_QUERY",
      status: 400,
    });
  }

  logger.info?.(`[Market] queryLength=${normalizedQuery.length}`);
  logger.info?.(`[Market] Provider: ${config.provider || "DataForSEO"} ${config.marketplace}`, { marketplace: config.marketplace });

  if (!provider) {
    logger.warn?.("[Market] Configuration: invalid", {
      missingEnvironmentVariables: config.missingEnvironmentVariables,
    });
    throw new MarketProviderError("A consulta de mercado ainda não foi configurada neste ambiente.", {
      code: "MARKET_NOT_CONFIGURED",
      details: { missingEnvironmentVariables: config.missingEnvironmentVariables },
      status: 503,
    });
  }

  logger.info?.("[Market] Configuration: valid");
  const result = await provider.search(normalizedQuery, { refresh, ...(signal ? { signal } : {}) });
  logger.info?.("[Market] Response: 200", {
    cached: result.cached === true,
    itemCount: result.results.length,
  });
  return result;
}
