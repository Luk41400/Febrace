import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { demoMarketProducts } from "../data/market-catalog-demo.js";
import { getMarketConfig, marketHealth } from "../lib/config.js";
import { createMarketProvider } from "../lib/market-provider.js";
import { runMarketSearch } from "../lib/market-search.js";
import { MARKET_CATALOG_SEARCH_SQL, createPostgresMarketProvider } from "../lib/postgres-market-provider.js";
import { marketSearchSchema, validate } from "../lib/validation.js";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Mouse sem Fio Ergonômico", price: "59.90", currency: "BRL",
  seller: "Loja de Teste", source: "Catálogo fictício", category: "mouse",
  image_url: "https://example.com/mouse.jpg", product_url: "https://example.com/mouse",
  rating: "4.5", reviews: 12,
};

function fakePool(rows = [row]) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("COUNT(*)")) return { rows: [{ count: rows.length }] };
      return { rows };
    },
  };
}

test("seleciona PostgreSQL sem credenciais e nunca instancia DataForSEO", () => {
  const config = getMarketConfig({ MARKET_PROVIDER: "postgres" });
  assert.deepEqual(marketHealth(config), {
    provider: "PostgreSQL Catalog", marketplace: "Catálogo local", configured: true,
  });
  const pool = fakePool();
  let dataForSeoCalls = 0;
  const provider = createMarketProvider(config, {
    pool,
    createDataForSeo() { dataForSeoCalls += 1; throw new Error("chamada proibida"); },
  });
  assert.equal(typeof provider.search, "function");
  assert.equal(dataForSeoCalls, 0);
  assert.equal(getMarketConfig({}).type, "dataforseo");
  assert.equal(createMarketProvider(getMarketConfig({}), { pool }), null);
  assert.throws(() => getMarketConfig({ MARKET_PROVIDER: "outro" }), /MARKET_PROVIDER/);
});

test("busca usa FTS parametrizado, acentos e palavras em qualquer ordem", async () => {
  const pool = fakePool();
  const provider = createPostgresMarketProvider({ pool, now: () => Date.UTC(2026, 9, 16) });
  const result = await provider.search(" FIO   MOUSE ");
  assert.equal(pool.calls.length, 1);
  assert.equal(pool.calls[0].sql, MARKET_CATALOG_SEARCH_SQL);
  assert.deepEqual(pool.calls[0].values, ["fio:* & mouse:*", "fio mouse", 20]);
  assert.deepEqual(result.results[0], {
    id: row.id, title: row.title, price: 59.9, currency: "BRL",
    source: row.source, seller: row.seller, image: row.image_url, url: row.product_url,
    consultedAt: "2026-10-16T00:00:00.000Z", rating: 4.5, reviews: 12,
  });
  assert.equal(result.provider, "PostgreSQL Catalog");
  assert.equal(result.marketplace, "Catálogo local");
  await provider.search("CADERNO UNIVERSITÁRIO");
  assert.equal(pool.calls[1].values[0], "caderno:* & universitario:*");
  await provider.search("cader");
  assert.equal(pool.calls[2].values[0], "cader:*");
});

test("descarta preço/moeda/URL inválidos e não inventa imagem ou avaliação", async () => {
  const pool = fakePool([
    { ...row, id: "valid", image_url: "", rating: null, reviews: null },
    { ...row, id: "zero", price: "0" },
    { ...row, id: "dollar", currency: "USD" },
    { ...row, id: "unsafe", product_url: "http://example.com/mouse" },
  ]);
  const result = await createPostgresMarketProvider({ pool }).search("mouse");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].image, "");
  assert.equal("rating" in result.results[0], false);
  assert.equal("reviews" in result.results[0], false);
});

test("consultas esperadas produzem termos de busca e ausência retorna lista vazia", async () => {
  const pool = fakePool([]);
  const provider = createPostgresMarketProvider({ pool });
  const examples = new Map([
    ["caderno", "caderno:*"],
    ["caderno universitário", "caderno:* & universitario:*"],
    ["mouse", "mouse:*"],
    ["mouse sem fio", "mouse:* & sem:* & fio:*"],
    ["mochila escolar", "mochila:* & escolar:*"],
  ]);
  for (const [query, expected] of examples) {
    const result = await provider.search(query);
    assert.deepEqual(result.results, []);
    assert.equal(pool.calls.at(-1).values[0], expected);
  }
  assert.equal(pool.calls.length, examples.size);
});

test("cacheia resultados e vazios, deduplica buscas simultâneas e permite refresh", async () => {
  let now = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let searchCalls = 0;
  const pool = {
    async query(sql) {
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 1 }] };
      searchCalls += 1;
      if (searchCalls === 1) return pending;
      return { rows: [] };
    },
  };
  const provider = createPostgresMarketProvider({ pool, now: () => now });
  const first = provider.search("mouse");
  const second = provider.search("MOUSE");
  assert.equal(searchCalls, 1);
  release({ rows: [row] });
  assert.equal((await first).results.length, 1);
  assert.equal((await second).results.length, 1);
  assert.equal((await provider.search("mouse")).cached, true);
  assert.equal(searchCalls, 1);
  assert.equal((await provider.search("mouse", { refresh: true })).results.length, 0);
  assert.equal(searchCalls, 2);
  assert.equal((await provider.search("mouse")).cached, true);
  now = 60_001;
  await provider.search("mouse");
  assert.equal(searchCalls, 3);
  assert.equal(await provider.countProducts(), 1);
});

test("falha do banco é neutra e não vaza mensagem interna", async () => {
  const provider = createPostgresMarketProvider({
    pool: { async query() { throw new Error("postgres://login:segredo@internal/production"); } },
  });
  await assert.rejects(
    () => provider.search("caderno"),
    (error) => error.status === 503 && error.code === "MARKET_CATALOG_UNAVAILABLE"
      && !error.message.includes("segredo"),
  );
});

test("seed contém 28 ofertas fictícias válidas e não depende de APIs externas", () => {
  assert.equal(demoMarketProducts.length, 28);
  assert.equal(new Set(demoMarketProducts.map((item) => item.title)).size, 28);
  assert.ok(new Set(demoMarketProducts.map((item) => item.category)).size >= 8);
  assert.ok(new Set(demoMarketProducts.map((item) => item.seller)).size >= 4);
  for (const item of demoMarketProducts) {
    assert.equal(item.currency, "BRL");
    assert.ok(item.price > 0);
    assert.match(item.productUrl, /^https:\/\/example\.com\//);
    assert.ok(!item.imageUrl || item.imageUrl.startsWith("https://"));
  }
});

test("rota real preserva autenticação e responde pelo provider PostgreSQL", async () => {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const start = serverSource.indexOf('app.get("/market/search"');
  const end = serverSource.indexOf('app.use("/ai"', start);
  assert.ok(start >= 0 && end > start);
  let handlers;
  const app = { get(path, ...received) { assert.equal(path, "/market/search"); handlers = received; } };
  const auth = (req, res, next) => req.headers.authorization === "Teste local"
    ? next()
    : res.status(401).json({ error: "Sua sessão expirou. Entre novamente.", code: "SESSION_REQUIRED" });
  const noop = (_req, _res, next) => next();
  const pool = fakePool([row]);
  let dataForSeoCalls = 0;
  const marketConfig = getMarketConfig({ MARKET_PROVIDER: "postgres" });
  const marketProvider = createMarketProvider(marketConfig, {
    pool,
    createDataForSeo() { dataForSeoCalls += 1; throw new Error("chamada proibida"); },
  });
  const context = vm.createContext({
    app, requireAuth: auth, marketSearchLimiter: noop, limitMarketRefresh: noop,
    marketProvider, marketConfig, runMarketSearch, validate, marketSearchSchema,
    AbortController,
  });
  vm.runInContext(serverSource.slice(start, end), context);
  assert.equal(handlers.length, 4);
  assert.equal(handlers[0], auth);

  async function request(authorized) {
    const req = Object.assign(new EventEmitter(), {
      headers: authorized ? { authorization: "Teste local" } : {},
      query: { q: "mouse" },
    });
    const result = { status: 200, body: null };
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      status(status) { result.status = status; return this; },
      json(body) { result.body = body; this.writableEnded = true; return this; },
    });
    let authenticated = false;
    handlers[0](req, res, () => { authenticated = true; });
    if (authenticated) await handlers[3](req, res, (error) => { throw error; });
    return result;
  }

  const denied = await request(false);
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, "SESSION_REQUIRED");
  assert.equal(pool.calls.length, 0);
  const allowed = await request(true);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.provider, "PostgreSQL Catalog");
  assert.equal(allowed.body.results.length, 1);
  assert.equal(allowed.body.results[0].price, 59.9);
  assert.equal(dataForSeoCalls, 0);
});
