import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { normalizeMarketQuery, rankMarketResults, simplifyMarketQuery } from "../js/domain/market-relevance.js";
import { readLimitedJsonResponse } from "./http-response.js";

export const DATAFORSEO_TASK_POST_URL = "https://api.dataforseo.com/v3/merchant/google/products/task_post";
export const DATAFORSEO_TASK_GET_URL = "https://api.dataforseo.com/v3/merchant/google/products/task_get/advanced";
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const EMPTY_CACHE_TTL_MS = 60_000;
const PENDING_TASK_TTL_MS = 30 * 60_000;
const SEARCH_RESULT_LIMIT = 20;
const MIN_PRIMARY_RESULTS = 5;
const SEARCH_RESPONSE_MAX_BYTES = 1_000_000;
const TASK_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PENDING_CODES = new Set([20100, 40601, 40602]);

const resultSchema = z.object({ items: z.array(z.unknown()).nullable() }).passthrough();
const taskSchema = z.object({
  id: z.string().optional(),
  status_code: z.number().int(),
  result: z.array(resultSchema).nullable().optional(),
}).passthrough();
const responseSchema = z.object({
  status_code: z.number().int(),
  tasks: z.array(taskSchema).nullable().optional(),
}).passthrough();

export class MarketProviderError extends Error {
  constructor(message, { code = "MARKET_PROVIDER_ERROR", details = {}, status = 503, retryable = false } = {}) {
    super(message);
    this.name = "MarketProviderError";
    this.code = code;
    this.details = details;
    this.status = status;
    this.retryable = retryable;
  }
}

function cancelledError() {
  return new MarketProviderError("A pesquisa de mercado foi cancelada.", { code: "MARKET_REQUEST_CANCELLED", status: 499 });
}

function timeoutError() {
  return new MarketProviderError("A pesquisa de mercado excedeu o tempo de resposta.", { code: "MARKET_TIMEOUT", status: 504, retryable: true });
}

function invalidResponseError() {
  return new MarketProviderError("O serviço de pesquisa retornou dados inválidos.", { code: "MARKET_INVALID_RESPONSE", status: 502 });
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function positivePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function optionalRating(value) {
  if (value?.rating_type !== "Max5" || (value.rating_max !== null && value.rating_max !== undefined && Number(value.rating_max) !== 5)) return null;
  const rating = Number(value.value);
  return value.value !== null && value.value !== undefined && Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
}

function optionalReviews(value) {
  const reviews = Number(value);
  return value !== null && value !== undefined && Number.isSafeInteger(reviews) && reviews >= 0 ? reviews : null;
}

function productUrl(product) {
  const directUrl = safeHttpsUrl(product.url) || safeHttpsUrl(product.shopping_url);
  if (directUrl) return directUrl;
  const productId = String(product.product_id || "");
  // Official Product Info examples use this Google Shopping URL for product_id.
  return /^\d{8,30}$/.test(productId)
    ? `https://www.google.com/shopping/product/${productId}?hl=pt-BR&gl=BR`
    : "";
}

function normalizeProduct(product, consultedAt) {
  if (!product || typeof product !== "object") return null;
  const title = String(product.title || "").trim();
  const seller = String(product.seller || "").trim();
  const url = productUrl(product);
  const image = Array.isArray(product.product_images)
    ? product.product_images.map(safeHttpsUrl).find(Boolean) || ""
    : "";
  const price = positivePrice(product.price);
  if (!title || !seller || !url || product.currency !== "BRL" || price === null) return null;

  const providerId = product.product_id || product.data_docid || product.gid;
  const id = providerId ? String(providerId) : createHash("sha256")
    .update(`${url}\n${title}\n${seller}`).digest("hex").slice(0, 24);
  const rating = optionalRating(product.product_rating);
  const reviews = optionalReviews(product.reviews_count ?? product.product_rating?.votes_count);
  return {
    id, title, price, currency: "BRL", source: seller, seller, image, url, consultedAt,
    ...(rating === null ? {} : { rating }),
    ...(reviews === null ? {} : { reviews }),
  };
}

function shoppingProducts(items) {
  const products = [];
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "google_shopping_serp") products.push(item);
    if (["google_shopping_carousel", "google_shopping_sponsored_carousel"].includes(item.type) && Array.isArray(item.items)) {
      products.push(...item.items.filter((entry) => ["google_shopping_carousel_element", "google_shopping_sponsored_carousel_element"].includes(entry?.type)));
    }
  }
  return products;
}

function errorForHttpStatus(status) {
  if (status === 400) return new MarketProviderError("A pesquisa enviada é inválida.", { code: "MARKET_INVALID_REQUEST", status });
  if (status === 401) return new MarketProviderError("A credencial da consulta de mercado é inválida.", { code: "MARKET_UNAUTHORIZED", status });
  if (status === 403) return new MarketProviderError("A conta não possui acesso à pesquisa de mercado.", { code: "MARKET_FORBIDDEN", status });
  if (status === 429) return new MarketProviderError("O provedor limitou temporariamente as consultas.", { code: "MARKET_UPSTREAM_RATE_LIMITED", status });
  if (status === 504) return timeoutError();
  return new MarketProviderError("A pesquisa de mercado está temporariamente indisponível.", {
    code: "MARKET_UNAVAILABLE", status: status >= 500 ? status : 503, retryable: true,
  });
}

function errorForApiStatus(upstreamCode, upstreamStatus) {
  const details = { upstreamStatus, upstreamCode };
  if (upstreamCode === 40100) return new MarketProviderError("A credencial da consulta de mercado é inválida.", { code: "MARKET_UNAUTHORIZED", details, status: 401 });
  if ([40104, 40201, 40204, 40207].includes(upstreamCode)) return new MarketProviderError("A conta não possui acesso à pesquisa de mercado.", { code: "MARKET_FORBIDDEN", details, status: 403 });
  if ([40202, 40205, 40206, 40209].includes(upstreamCode)) return new MarketProviderError("O provedor limitou temporariamente as consultas.", { code: "MARKET_UPSTREAM_RATE_LIMITED", details, status: 429 });
  if ([50401, 50402].includes(upstreamCode)) return new MarketProviderError("A pesquisa de mercado excedeu o tempo de resposta.", { code: "MARKET_TIMEOUT", details, status: 504, retryable: true });
  if ([40200, 40203, 40210].includes(upstreamCode)) return new MarketProviderError("A conta de pesquisa de mercado não pode processar consultas no momento.", { code: "MARKET_UNAVAILABLE", details, status: 503 });
  if (upstreamCode >= 40000 && upstreamCode < 50000) return new MarketProviderError("O provedor recusou a pesquisa de mercado.", { code: "MARKET_PROVIDER_ERROR", details, status: 502 });
  return new MarketProviderError("A pesquisa de mercado está temporariamente indisponível.", { code: "MARKET_UNAVAILABLE", details, status: 503, retryable: true });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

export class DataForSeoMarketProvider {
  #authorization;
  #clockNow;
  #durationNow;
  #fetch;
  #inflightSearches = new Map();
  #languageCode;
  #locationCode;
  #logger;
  #maxPollAttempts;
  #now;
  #pendingTasks = new Map();
  #pollIntervalMs;
  #searchCache = new Map();
  #searchCacheTtlMs;
  #sleep;
  #taskTimeoutMs;
  #timeoutMs;

  constructor({
    login, password, timeoutMs = 15_000, taskTimeoutMs = 120_000,
    languageCode = "pt-BR", locationCode = 2076, fetchImpl = globalThis.fetch,
    logger = console, now = Date.now, durationNow = Date.now,
    clockNow = () => performance.now(),
    sleepImpl = (ms, signal) => delay(ms, undefined, { signal }),
    pollIntervalMs = 2_000, maxPollAttempts = 60,
    searchCacheTtlMs = SEARCH_CACHE_TTL_MS,
  } = {}) {
    if (!String(login || "").trim() || !String(password || "").trim()) {
      throw new MarketProviderError("A consulta de mercado não foi configurada neste ambiente.", { code: "MARKET_NOT_CONFIGURED" });
    }
    if (typeof fetchImpl !== "function") throw new TypeError("Um cliente HTTP compatível com fetch é obrigatório.");
    this.#authorization = `Basic ${Buffer.from(`${login.trim()}:${password.trim()}`, "utf8").toString("base64")}`;
    this.#clockNow = clockNow;
    this.#durationNow = durationNow;
    this.#fetch = fetchImpl;
    this.#languageCode = languageCode;
    this.#locationCode = locationCode;
    this.#logger = logger;
    this.#maxPollAttempts = maxPollAttempts;
    this.#now = now;
    this.#pollIntervalMs = pollIntervalMs;
    this.#searchCacheTtlMs = searchCacheTtlMs;
    this.#sleep = sleepImpl;
    this.#taskTimeoutMs = taskTimeoutMs;
    this.#timeoutMs = timeoutMs;
  }

  async #fetchEnvelope(url, options, signal, deadline) {
    throwIfAborted(signal);
    const remaining = deadline - this.#clockNow();
    if (remaining <= 0) throw timeoutError();
    const requestTimeout = AbortSignal.timeout(Math.max(1, Math.min(this.#timeoutMs, Math.ceil(remaining))));
    const combined = AbortSignal.any([requestTimeout, signal]);
    let response;
    try {
      response = await this.#fetch(url, {
        ...options,
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: this.#authorization },
        redirect: "error",
        signal: combined,
      });
    } catch (error) {
      if (signal.aborted) throw cancelledError();
      if (requestTimeout.aborted || ["TimeoutError", "AbortError"].includes(error?.name)) throw timeoutError();
      throw new MarketProviderError("Não foi possível conectar ao serviço de pesquisa de mercado.", { code: "MARKET_UNAVAILABLE", status: 503, retryable: true });
    }
    throwIfAborted(signal);
    this.#logger.info?.(`[Market] Status: ${response.status}`);
    if (!response.ok) throw errorForHttpStatus(response.status);
    let payload;
    try {
      payload = await readLimitedJsonResponse(response, { maxBytes: SEARCH_RESPONSE_MAX_BYTES });
    } catch (error) {
      if (signal.aborted) throw cancelledError();
      if (requestTimeout.aborted || ["TimeoutError", "AbortError"].includes(error?.name)) throw timeoutError();
      throw invalidResponseError();
    }
    throwIfAborted(signal);
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw invalidResponseError();
    return { envelope: parsed.data, status: response.status };
  }

  #singleTask(envelope, status, { allowPendingEnvelope = false } = {}) {
    if (allowPendingEnvelope && PENDING_CODES.has(envelope.status_code)) return null;
    if (envelope.status_code !== 20000) throw errorForApiStatus(envelope.status_code, status);
    if (!Array.isArray(envelope.tasks) || envelope.tasks.length !== 1) throw invalidResponseError();
    return envelope.tasks[0];
  }

  async #postTask(query, signal, deadline) {
    const { envelope, status } = await this.#fetchEnvelope(DATAFORSEO_TASK_POST_URL, {
      method: "POST",
      body: JSON.stringify([{
        keyword: query, location_code: this.#locationCode,
        language_code: this.#languageCode, depth: 40, priority: 2,
      }]),
    }, signal, deadline);
    const task = this.#singleTask(envelope, status);
    if (task.status_code !== 20100) throw errorForApiStatus(task.status_code, status);
    if (!TASK_ID_PATTERN.test(task.id || "")) throw invalidResponseError();
    this.#pendingTasks.set(query.toLocaleLowerCase("pt-BR"), { id: task.id, createdAt: this.#now() });
    if (this.#pendingTasks.size > 50) this.#pendingTasks.delete(this.#pendingTasks.keys().next().value);
    return task.id;
  }

  async #pollTask(id, signal, deadline) {
    for (let attempt = 1; attempt <= this.#maxPollAttempts; attempt += 1) {
      const { envelope, status } = await this.#fetchEnvelope(`${DATAFORSEO_TASK_GET_URL}/${id}`, { method: "GET" }, signal, deadline);
      const task = this.#singleTask(envelope, status, { allowPendingEnvelope: true });
      if (task && task.id !== id) throw invalidResponseError();
      if (task?.status_code === 40102) return [];
      if (task && [20000, 40106].includes(task.status_code) && Array.isArray(task.result)) {
        if (task.result.length !== 1) throw invalidResponseError();
        return task.result[0].items || [];
      }
      if (task && !PENDING_CODES.has(task.status_code) && !(task.status_code === 20000 && task.result == null)) {
        throw errorForApiStatus(task.status_code, status);
      }
      if (attempt === this.#maxPollAttempts) break;
      const remaining = deadline - this.#clockNow();
      if (remaining <= 0) break;
      try {
        await this.#sleep(Math.min(this.#pollIntervalMs, remaining), signal);
      } catch (error) {
        if (signal.aborted) throw cancelledError();
        throw error;
      }
    }
    throw timeoutError();
  }

  async #requestSearch(query, signal, deadline) {
    const startedAt = this.#durationNow();
    const key = query.toLocaleLowerCase("pt-BR");
    const pending = this.#pendingTasks.get(key);
    const id = pending && pending.createdAt + PENDING_TASK_TTL_MS > this.#now()
      ? pending.id
      : await this.#postTask(query, signal, deadline);
    try {
      const items = await this.#pollTask(id, signal, deadline);
      this.#pendingTasks.delete(key);
      const products = shoppingProducts(items);
      const consultedAt = new Date(this.#now()).toISOString();
      const seen = new Set();
      const results = products.map((product) => normalizeProduct(product, consultedAt)).filter((item) => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      this.#logger.info?.(`[Market] Results: ${results.length}`, { received: products.length });
      return { results, query, page: 1, received: products.length };
    } catch (error) {
      if (!["MARKET_TIMEOUT", "MARKET_REQUEST_CANCELLED", "MARKET_UNAVAILABLE", "MARKET_UPSTREAM_RATE_LIMITED"].includes(error.code)) {
        this.#pendingTasks.delete(key);
      }
      throw error;
    } finally {
      this.#logger.info?.(`[Market] Duration: ${Math.max(0, Math.round(this.#durationNow() - startedAt))}ms`);
    }
  }

  async #searchFresh(query, signal) {
    const deadline = this.#clockNow() + this.#taskTimeoutMs;
    const searches = [];
    const first = await this.#requestSearch(query, signal, deadline);
    searches.push({ query: first.query, page: first.page, received: first.received, normalized: first.results.length });
    const candidates = [...first.results];
    let ranked = rankMarketResults(candidates, query);

    const simplerQuery = simplifyMarketQuery(query);
    if (ranked.primaryCount < MIN_PRIMARY_RESULTS && simplerQuery !== query && deadline - this.#clockNow() >= 60_000) {
      try {
        const second = await this.#requestSearch(simplerQuery, signal, deadline);
        searches.push({ query: second.query, page: second.page, received: second.received, normalized: second.results.length });
        const seen = new Set(candidates.map((item) => item.id));
        for (const item of second.results) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          candidates.push(item);
        }
        ranked = rankMarketResults(candidates, query);
      } catch (error) {
        if (error.code === "MARKET_REQUEST_CANCELLED" || !ranked.results.length) throw error;
        this.#logger.warn?.("[Market] Additional search failed", { code: error.code || "MARKET_PROVIDER_ERROR" });
      }
    }

    throwIfAborted(signal);
    const results = ranked.results.slice(0, SEARCH_RESULT_LIMIT);
    this.#logger.info?.("[Market] Relevance", { candidates: candidates.length, retained: results.length, primary: ranked.primaryCount, accessories: ranked.accessoryCount });
    return {
      results, consultedAt: new Date(this.#now()).toISOString(),
      receivedCount: searches.reduce((sum, search) => sum + search.received, 0),
      normalizedCount: candidates.length, retainedCount: results.length, searches,
    };
  }

  async #joinSearch(entry, signal) {
    entry.waiters += 1;
    try {
      throwIfAborted(signal);
      if (!signal) return await entry.promise;
      return await new Promise((resolve, reject) => {
        const onAbort = () => reject(cancelledError());
        signal.addEventListener("abort", onAbort, { once: true });
        entry.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
      });
    } finally {
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort();
    }
  }

  async search(query, { refresh = false, signal } = {}) {
    const normalizedQuery = normalizeMarketQuery(query);
    if (normalizedQuery.length < 3) throw new MarketProviderError("Informe pelo menos 3 caracteres para pesquisar.", { code: "INVALID_MARKET_QUERY", status: 400 });
    throwIfAborted(signal);
    const key = normalizedQuery.toLocaleLowerCase("pt-BR");
    const cached = this.#searchCache.get(key);
    if (!refresh && cached && cached.expiresAt > this.#now()) {
      this.#logger.info?.("[Market] Cache: hit");
      return { ...cached.result, cached: true };
    }
    if (cached) this.#searchCache.delete(key);
    let entry = this.#inflightSearches.get(key);
    if (!entry || entry.controller.signal.aborted) {
      entry = { controller: new AbortController(), waiters: 0, settled: false, promise: null };
      const currentEntry = entry;
      entry.promise = this.#searchFresh(normalizedQuery, entry.controller.signal)
        .then((response) => {
          const result = { ...response, query: normalizedQuery, marketplace: "Google Shopping", provider: "DataForSEO / Google Shopping" };
          this.#searchCache.set(key, { expiresAt: this.#now() + (result.results.length ? this.#searchCacheTtlMs : EMPTY_CACHE_TTL_MS), result });
          if (this.#searchCache.size > 50) this.#searchCache.delete(this.#searchCache.keys().next().value);
          return result;
        })
        .finally(() => {
          currentEntry.settled = true;
          if (this.#inflightSearches.get(key) === currentEntry) this.#inflightSearches.delete(key);
        });
      this.#inflightSearches.set(key, entry);
    }
    return this.#joinSearch(entry, signal);
  }
}

export function createDataForSeoMarketProvider(config, dependencies = {}) {
  return new DataForSeoMarketProvider({ ...config, ...dependencies });
}

export function redactMarketProviderSensitiveData(value, secrets = []) {
  let sanitized = String(value || "").replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  for (const secret of secrets) if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  return sanitized;
}

export function marketProviderErrorForClient(error) {
  const details = {};
  if (Number.isInteger(error.details?.upstreamStatus)) details.upstreamStatus = error.details.upstreamStatus;
  if (Number.isInteger(error.details?.upstreamCode)) details.upstreamCode = error.details.upstreamCode;
  if (Array.isArray(error.details?.missingEnvironmentVariables)) {
    details.missingEnvironmentVariables = error.details.missingEnvironmentVariables
      .filter((name) => ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"].includes(name));
  }
  return { error: error.message, code: error.code, ...details };
}
