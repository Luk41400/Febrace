import assert from "node:assert/strict";
import test from "node:test";

import { getDataForSeoConfig, marketHealth } from "../lib/config.js";
import {
  createDataForSeoMarketProvider,
  DATAFORSEO_TASK_POST_URL,
  DATAFORSEO_TASK_GET_URL,
  MarketProviderError,
  marketProviderErrorForClient,
  redactMarketProviderSensitiveData,
} from "../lib/dataforseo-market-provider.js";

const credentials = { login: "login@example.com", password: "private-password" };
const quietLogger = { info() {}, warn() {} };
const taskId = "06181608-2806-0179-0000-aff47b17cd54";
const otherTaskId = "06181608-2806-0179-0000-aff47b17cd55";
const product = {
  type: "google_shopping_serp",
  title: "Apple iPhone 15 Pro Max 256 GB",
  seller: "Loja Exemplo",
  price: 7499,
  currency: "BRL",
  product_id: "3805205938126402128",
  url: null,
  shopping_url: null,
  product_images: ["https://images.example.com/iphone.jpg"],
  product_rating: { rating_type: "Max5", rating_max: null, value: "4.8", votes_count: 321 },
  reviews_count: 322,
};

function response(status, payload, headers = new Map()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) || null },
    async text() { return payload === null ? "" : JSON.stringify(payload); },
  };
}

function postPayload(id = taskId, code = 20100) {
  return { status_code: 20000, tasks: [{ id, status_code: code, result: null }] };
}

function getPayload(items, { id = taskId, code = 20000, result = [{ items }] } = {}) {
  return { status_code: 20000, tasks: [{ id, status_code: code, result }] };
}

function mockFetch({ items = [product], getCodes = [], postCode = 20100 } = {}) {
  const calls = [];
  let getIndex = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return response(200, postPayload(taskId, postCode));
    const code = getCodes[getIndex++] ?? 20000;
    return response(200, getPayload(items, { code, result: [40601, 40602].includes(code) ? null : [{ items }] }));
  };
  return { calls, fetchImpl };
}

function providerWith(fetchImpl, overrides = {}) {
  return createDataForSeoMarketProvider(credentials, {
    fetchImpl, logger: quietLogger, sleepImpl: async () => {}, ...overrides,
  });
}

test("configura Brasil, português e prazo total sem expor credenciais no health", () => {
  const config = getDataForSeoConfig({
    DATAFORSEO_LOGIN: credentials.login, DATAFORSEO_PASSWORD: credentials.password,
    DATAFORSEO_TIMEOUT_MS: "9000", DATAFORSEO_TASK_TIMEOUT_MS: "90000",
  });
  assert.equal(config.locationCode, 2076);
  assert.equal(config.languageCode, "pt-BR");
  assert.equal(config.timeoutMs, 9000);
  assert.equal(config.taskTimeoutMs, 90000);
  assert.deepEqual(marketHealth(config), { provider: "DataForSEO", marketplace: "Google Shopping", configured: true });
  assert.doesNotMatch(JSON.stringify(marketHealth(config)), /login|password|private-password/i);
  assert.deepEqual(getDataForSeoConfig({}).missingEnvironmentVariables, ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]);
  assert.throws(() => getDataForSeoConfig({ DATAFORSEO_TASK_TIMEOUT_MS: "999999" }), /DATAFORSEO_TASK_TIMEOUT_MS/);
  assert.throws(() => createDataForSeoMarketProvider({}), { code: "MARKET_NOT_CONFIGURED" });
});

test("cria task Merchant de alta prioridade e busca resultado por ID sem expor esse ID ao frontend", async () => {
  const { calls, fetchImpl } = mockFetch();
  const provider = providerWith(fetchImpl, { now: () => Date.UTC(2026, 9, 14) });
  const result = await provider.search(" iPhone   15 Pro Max ");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, DATAFORSEO_TASK_POST_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization,
    `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), [{
    keyword: "iPhone 15 Pro Max", location_code: 2076, language_code: "pt-BR", depth: 40, priority: 2,
  }]);
  assert.equal(calls[1].url, `${DATAFORSEO_TASK_GET_URL}/${taskId}`);
  assert.equal(calls[1].options.method, "GET");
  assert.deepEqual(result.results[0], {
    id: product.product_id, title: product.title, price: 7499, currency: "BRL",
    source: product.seller, seller: product.seller, image: product.product_images[0],
    url: `https://www.google.com/shopping/product/${product.product_id}?hl=pt-BR&gl=BR`,
    consultedAt: "2026-10-14T00:00:00.000Z", rating: 4.8, reviews: 322,
  });
  assert.equal(result.provider, "DataForSEO / Google Shopping");
  assert.equal(result.marketplace, "Google Shopping");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(taskId));
  assert.doesNotMatch(calls[0].url + calls[0].options.body, /private-password|login@example\.com/);
});

test("usa URLs e imagens oficiais de produto, aceita carrosséis e descarta preços ou moedas inválidos", async () => {
  const carousel = {
    type: "google_shopping_carousel",
    items: [{
      type: "google_shopping_carousel_element", title: "iPhone 15 Pro Max 512GB",
      seller: "Loja Brasil", price: 8199.5, currency: "BRL",
      shopping_url: "https://www.google.com/search?ibp=oshop&q=gid%3A123",
      product_images: ["http://example.com/insecure.jpg", "https://example.com/secure.jpg"],
      product_rating: { rating_type: "Max5", rating_max: 5, value: 4.6, votes_count: 20 },
    }],
  };
  const sponsored = {
    type: "google_shopping_sponsored_carousel",
    items: [{ ...product, type: "google_shopping_sponsored_carousel_element", product_id: "9999999999999999999", title: "iPhone 15 Pro Max patrocinado" }],
  };
  const items = [
    product, carousel, sponsored,
    { ...product, product_id: "1", price: 0 },
    { ...product, product_id: "2", price: 100, currency: "USD" },
    { ...product, product_id: "3", price: 100, currency: null },
    { ...product, product_id: "4", seller: "" },
    { ...product, product_id: null, shopping_url: null, url: "http://unsafe.example.com" },
  ];
  const { fetchImpl } = mockFetch({ items });
  const result = await providerWith(fetchImpl).search("iPhone 15 Pro Max");
  assert.equal(result.results.length, 3);
  const item = result.results.find((entry) => entry.seller === "Loja Brasil");
  assert.deepEqual({ url: item.url, image: item.image, rating: item.rating, reviews: item.reviews }, {
    url: carousel.items[0].shopping_url, image: "https://example.com/secure.jpg", rating: 4.6, reviews: 20,
  });
});

test("não inventa avaliação ou URL quando não há ID ou link seguro", async () => {
  const items = [
    { ...product, product_rating: { rating_type: "Percents", value: 90, votes_count: null }, reviews_count: null, product_images: ["http://unsafe.example.com"] },
    { ...product, product_id: null, url: null, shopping_url: null },
  ];
  const result = await providerWith(mockFetch({ items }).fetchImpl).search("iPhone 15 Pro Max");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].image, "");
  assert.equal("rating" in result.results[0], false);
  assert.equal("reviews" in result.results[0], false);
});

test("polling trata task recebida, fila e resultado nulo com intervalo controlado", async () => {
  const { calls, fetchImpl } = mockFetch({ getCodes: [40601, 40602, 20000, 20000] });
  let polls = 0;
  const provider = providerWith(async (url, options) => {
    if (options.method === "GET" && polls++ === 2) return response(200, getPayload([], { result: null }));
    return fetchImpl(url, options);
  });
  const result = await provider.search("iPhone 15 Pro Max");
  assert.equal(result.results.length, 1);
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(polls, 4);
});

test("limita tentativas e reutiliza a task pendente após timeout sem novo POST", async () => {
  let ready = false;
  let posts = 0;
  let gets = 0;
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") { posts += 1; return response(200, postPayload()); }
    gets += 1;
    return response(200, ready ? getPayload([product]) : getPayload([], { code: 40602, result: null }));
  }, { maxPollAttempts: 3 });
  await assert.rejects(() => provider.search("iPhone 15 Pro Max"), { code: "MARKET_TIMEOUT", status: 504 });
  assert.equal(posts, 1);
  assert.equal(gets, 3);
  ready = true;
  assert.equal((await provider.search("iPhone 15 Pro Max")).results.length, 1);
  assert.equal(posts, 1);
  assert.equal(gets, 4);
});

test("prazo total interrompe polling mesmo que reste tentativa", async () => {
  let clock = 0;
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") return response(200, postPayload());
    clock += 2_000;
    return response(200, getPayload([], { code: 40602, result: null }));
  }, { clockNow: () => clock, taskTimeoutMs: 3_000, maxPollAttempts: 60 });
  await assert.rejects(() => provider.search("iPhone 15 Pro Max"), { code: "MARKET_TIMEOUT", status: 504 });
});

test("desconexão de um solicitante preserva pesquisa compartilhada; última desconexão aborta polling", async () => {
  const pendingGet = [];
  let posts = 0;
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") { posts += 1; return response(200, postPayload()); }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject({ name: "AbortError" });
      options.signal.addEventListener("abort", onAbort, { once: true });
      pendingGet.push(() => {
        options.signal.removeEventListener("abort", onAbort);
        resolve(response(200, getPayload([product])));
      });
    });
  });
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();
  const first = provider.search("iPhone 15 Pro Max", { signal: firstAbort.signal });
  const second = provider.search("iPhone 15 Pro Max", { signal: secondAbort.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts, 1);
  assert.equal(pendingGet.length, 1);
  firstAbort.abort();
  await assert.rejects(first, { code: "MARKET_REQUEST_CANCELLED", status: 499 });
  pendingGet.shift()();
  assert.equal((await second).results.length, 1);

  const lastAbort = new AbortController();
  const last = provider.search("iPhone 15 Pro Max", { refresh: true, signal: lastAbort.signal });
  await new Promise((resolve) => setImmediate(resolve));
  lastAbort.abort();
  await assert.rejects(last, { code: "MARKET_REQUEST_CANCELLED", status: 499 });
});

test("cache de cinco minutos, deduplicação e refresh evitam tasks repetidas", async () => {
  let posts = 0;
  let now = 1_000;
  const products = Array.from({ length: 5 }, (_, index) => ({ ...product, product_id: String(3805205938126402128n + BigInt(index)), title: `iPhone 15 Pro Max ${index}` }));
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") { posts += 1; return response(200, postPayload(posts === 1 ? taskId : otherTaskId)); }
    return response(200, getPayload(products, { id: posts === 1 ? taskId : otherTaskId }));
  }, { now: () => now });
  const [first, simultaneous] = await Promise.all([provider.search("iPhone 15 Pro Max"), provider.search("iPhone 15 Pro Max")]);
  assert.equal(posts, 1);
  assert.equal(first.results.length, 5);
  assert.deepEqual(first, simultaneous);
  assert.equal((await provider.search("iphone 15 pro max")).cached, true);
  now += 30_000;
  await provider.search("iPhone 15 Pro Max", { refresh: true });
  assert.equal(posts, 2);
  now += 300_001;
  await provider.search("iPhone 15 Pro Max");
  assert.equal(posts, 3);
});

test("resposta vazia recebe cache de um minuto sem pesquisa redundante", async () => {
  let posts = 0;
  let now = 0;
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") { posts += 1; return response(200, postPayload()); }
    return response(200, getPayload([], { code: 40102, result: null }));
  }, { now: () => now });
  assert.deepEqual((await provider.search("produto inexistente xyz123abc")).results, []);
  assert.equal(posts, 1);
  now += 59_000;
  assert.equal((await provider.search("produto inexistente xyz123abc")).cached, true);
  now += 1_001;
  await provider.search("produto inexistente xyz123abc");
  assert.equal(posts, 2);
});

test("segunda task só usa consulta simplificada quando aumenta chance de relevância", async () => {
  const keywords = [];
  let posts = 0;
  const provider = providerWith(async (_url, options) => {
    if (options.method === "POST") {
      keywords.push(JSON.parse(options.body)[0].keyword);
      posts += 1;
      return response(200, postPayload(posts === 1 ? taskId : otherTaskId));
    }
    return response(200, getPayload(posts === 1 ? [] : [{ ...product, title: "iPhone 18 Pro Max 512GB" }], { id: posts === 1 ? taskId : otherTaskId }));
  });
  const result = await provider.search("Apple Iphone 18 Pro Max 256GB");
  assert.deepEqual(keywords, ["Apple iPhone 18 Pro Max 256GB", "iPhone 18 Pro Max"]);
  assert.equal(result.results.length, 1);
  const simple = providerWith(mockFetch({ items: [product] }).fetchImpl);
  assert.equal((await simple.search("iPhone 15 Pro Max")).searches.length, 1);
});

test("ranking não promove acessórios acima do produto principal", async () => {
  const accessories = Array.from({ length: 12 }, (_, index) => ({ ...product, product_id: String(3805205938126402128n + BigInt(index)), title: `Capa para iPhone 18 Pro Max ${index}` }));
  const result = await providerWith(mockFetch({ items: [...accessories, { ...product, title: "iPhone 18 Pro Max 256GB", product_id: "3805205938126402199" }] }).fetchImpl)
    .search("iPhone 18 Pro Max");
  assert.deepEqual(result.results.map((item) => item.title), ["iPhone 18 Pro Max 256GB"]);
});

for (const [status, code, expectedStatus] of [
  [401, "MARKET_UNAUTHORIZED", 401], [403, "MARKET_FORBIDDEN", 403],
  [429, "MARKET_UPSTREAM_RATE_LIMITED", 429], [500, "MARKET_UNAVAILABLE", 500],
  [503, "MARKET_UNAVAILABLE", 503], [504, "MARKET_TIMEOUT", 504],
]) {
  test(`mapeia HTTP ${status} para ${code}`, async () => {
    const provider = providerWith(async () => response(status, { status_message: "private-password" }));
    await assert.rejects(() => provider.search("produto"), { code, status: expectedStatus });
  });
}

for (const [upstreamCode, code, status] of [
  [40100, "MARKET_UNAUTHORIZED", 401], [40104, "MARKET_FORBIDDEN", 403],
  [40202, "MARKET_UPSTREAM_RATE_LIMITED", 429], [40210, "MARKET_UNAVAILABLE", 503],
  [40501, "MARKET_PROVIDER_ERROR", 502], [50301, "MARKET_UNAVAILABLE", 503],
  [50401, "MARKET_TIMEOUT", 504],
]) {
  test(`mapeia status interno ${upstreamCode} sem expor resposta bruta`, async () => {
    const provider = providerWith(async () => response(200, { status_code: 20000, tasks: [{ id: taskId, status_code: upstreamCode, result: null }] }));
    await assert.rejects(() => provider.search("produto"), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.deepEqual(error.details, { upstreamStatus: 200, upstreamCode });
      return true;
    });
  });
}

test("mapeia falhas globais mesmo sem tasks", async () => {
  for (const [upstreamCode, code, status] of [[40100, "MARKET_UNAUTHORIZED", 401], [40104, "MARKET_FORBIDDEN", 403], [40202, "MARKET_UPSTREAM_RATE_LIMITED", 429]]) {
    const provider = providerWith(async () => response(200, { status_code: upstreamCode, tasks: null, status_message: "private-password" }));
    await assert.rejects(() => provider.search("produto"), { code, status });
  }
});

test("rejeita task ID, envelope e resultado inválidos e limita o corpo", async () => {
  for (const payload of [null, {}, { status_code: 20000, tasks: [] }, postPayload("../../bad")]) {
    const provider = providerWith(async () => response(200, payload));
    await assert.rejects(() => provider.search("produto"), { code: "MARKET_INVALID_RESPONSE", status: 502 });
  }
  const badGet = providerWith(async (_url, options) => response(200, options.method === "POST" ? postPayload() : getPayload([], { result: [{ items: {} }] })));
  await assert.rejects(() => badGet.search("produto"), { code: "MARKET_INVALID_RESPONSE", status: 502 });
  let read = false;
  const oversized = response(200, postPayload(), new Map([["content-length", "1000001"]]));
  oversized.text = async () => { read = true; return "{}"; };
  await assert.rejects(() => providerWith(async () => oversized).search("produto"), { code: "MARKET_INVALID_RESPONSE", status: 502 });
  assert.equal(read, false);
});

test("segredos, resposta bruta e task ID não aparecem nos erros ou logs", async () => {
  const logs = [];
  const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  const provider = providerWith(async () => response(401, { message: `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}` }), { logger });
  await assert.rejects(() => provider.search("iPhone 15 Pro Max"), (error) => {
    const publicError = marketProviderErrorForClient(error);
    assert.equal(publicError.code, "MARKET_UNAUTHORIZED");
    assert.doesNotMatch(JSON.stringify(publicError), /private-password|login@example|Basic/);
    return true;
  });
  assert.doesNotMatch(JSON.stringify(logs), /private-password|login@example|Basic|iPhone 15 Pro Max/);
  assert.equal(redactMarketProviderSensitiveData("Authorization: Basic abc123 private-password login@example.com", [credentials.login, credentials.password]),
    "Authorization: Basic [REDACTED] [REDACTED] [REDACTED]");
  const safe = marketProviderErrorForClient(new MarketProviderError("Falha segura.", {
    code: "MARKET_UNAVAILABLE", details: { upstreamStatus: 200, upstreamCode: 50301, raw: credentials.password, missingEnvironmentVariables: ["DATAFORSEO_LOGIN", "SECRET"] },
  }));
  assert.deepEqual(safe, { error: "Falha segura.", code: "MARKET_UNAVAILABLE", upstreamStatus: 200, upstreamCode: 50301, missingEnvironmentVariables: ["DATAFORSEO_LOGIN"] });
});
