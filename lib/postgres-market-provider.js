import { normalizeMarketQuery } from "../js/domain/market-relevance.js";
import { MarketProviderError } from "./dataforseo-market-provider.js";

const RESULT_CACHE_TTL_MS = 5 * 60_000;
const EMPTY_CACHE_TTL_MS = 60_000;
const COUNT_CACHE_TTL_MS = 60_000;
const MAX_RESULTS = 20;

export const MARKET_CATALOG_SEARCH_SQL = `
  SELECT id, title, price, currency, seller, source, image_url, product_url, rating, reviews
  FROM market_catalog
  WHERE to_tsvector('simple', search_text) @@ to_tsquery('simple', $1)
  ORDER BY
    CASE WHEN search_text LIKE $2 || '%' THEN 1 ELSE 0 END DESC,
    ts_rank_cd(to_tsvector('simple', search_text), to_tsquery('simple', $1)) DESC,
    updated_at DESC, price ASC, id
  LIMIT $3
`;

function searchWords(query) {
  return [...new Set(
    normalizeMarketQuery(query)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [],
  )];
}

function cancelledError() {
  return new MarketProviderError("A pesquisa de mercado foi cancelada.", {
    code: "MARKET_REQUEST_CANCELLED", status: 499,
  });
}

function checkSignal(signal) {
  if (signal?.aborted) throw cancelledError();
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function catalogResult(row, consultedAt) {
  const price = Number(row.price);
  const title = String(row.title || "").trim();
  const seller = String(row.seller || "").trim();
  const url = safeHttpsUrl(row.product_url);
  if (!row.id || !title || !seller || !url || row.currency !== "BRL" || !Number.isFinite(price) || price <= 0) return null;
  const image = safeHttpsUrl(row.image_url);
  const rating = row.rating == null ? null : Number(row.rating);
  const reviews = row.reviews == null ? null : Number(row.reviews);
  return {
    id: String(row.id), title, price, currency: "BRL",
    source: String(row.source || seller), seller, image, url, consultedAt,
    ...(Number.isFinite(rating) && rating >= 0 && rating <= 5 ? { rating } : {}),
    ...(Number.isSafeInteger(reviews) && reviews >= 0 ? { reviews } : {}),
  };
}

export class PostgresMarketProvider {
  #pool;
  #now;
  #searchCache = new Map();
  #inflight = new Map();
  #countCache = null;

  constructor({ pool, now = Date.now } = {}) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("Um pool PostgreSQL é obrigatório.");
    this.#pool = pool;
    this.#now = now;
  }

  async countProducts() {
    if (this.#countCache && this.#countCache.expiresAt > this.#now()) return this.#countCache.value;
    try {
      const { rows } = await this.#pool.query("SELECT COUNT(*) AS count FROM market_catalog");
      const count = Number(rows[0]?.count || 0);
      this.#countCache = { value: count, expiresAt: this.#now() + COUNT_CACHE_TTL_MS };
      return count;
    } catch {
      throw new MarketProviderError("O catálogo de mercado está indisponível. Execute as migrations.", {
        code: "MARKET_CATALOG_UNAVAILABLE", status: 503,
      });
    }
  }

  async #searchFresh(query, words) {
    const tsquery = words.map((word) => `${word}:*`).join(" & ");
    let rows;
    try {
      ({ rows } = await this.#pool.query(MARKET_CATALOG_SEARCH_SQL, [tsquery, words.join(" "), MAX_RESULTS]));
    } catch {
      throw new MarketProviderError("O catálogo de mercado está indisponível. Execute as migrations.", {
        code: "MARKET_CATALOG_UNAVAILABLE", status: 503,
      });
    }
    const consultedAt = new Date(this.#now()).toISOString();
    const seen = new Set();
    const results = rows.map((row) => catalogResult(row, consultedAt)).filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    return {
      query, marketplace: "Catálogo local", provider: "PostgreSQL Catalog", results, consultedAt,
      receivedCount: rows.length, normalizedCount: results.length, retainedCount: results.length,
      searches: [{ query, page: 1, received: rows.length, normalized: results.length }],
    };
  }

  async search(query, { refresh = false, signal } = {}) {
    const normalized = normalizeMarketQuery(query);
    const words = searchWords(normalized);
    if (normalized.length < 3 || words.length === 0) {
      throw new MarketProviderError("Informe um produto para pesquisar.", { code: "INVALID_MARKET_QUERY", status: 400 });
    }
    checkSignal(signal);
    const key = words.join(" ");
    const cached = this.#searchCache.get(key);
    if (!refresh && cached?.expiresAt > this.#now()) return { ...cached.result, cached: true };
    if (cached) this.#searchCache.delete(key);

    let pending = this.#inflight.get(key);
    if (!pending) {
      pending = this.#searchFresh(normalized, words).then((result) => {
        this.#searchCache.set(key, {
          result, expiresAt: this.#now() + (result.results.length ? RESULT_CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
        });
        if (this.#searchCache.size > 50) this.#searchCache.delete(this.#searchCache.keys().next().value);
        return result;
      }).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, pending);
    }
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(cancelledError());
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then(
        (result) => { signal.removeEventListener("abort", onAbort); resolve(result); },
        (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
      );
    });
  }
}

export function createPostgresMarketProvider(options) {
  return new PostgresMarketProvider(options);
}
