import "dotenv/config";

export const FOCUS_NFE_ENVIRONMENTS = Object.freeze({
  homologation: "https://homologacao.focusnfe.com.br",
  production: "https://api.focusnfe.com.br",
});

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi definida. Consulte .env.example.`);
  return value;
}

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const sessionSecret = required("SESSION_SECRET");

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET deve ter ao menos 32 caracteres aleatórios.");
  }

  return {
    databaseUrl: required("DATABASE_URL"),
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: Number.parseInt(process.env.PORT || "3000", 10),
    sessionSecret,
    secureCookie: process.env.SESSION_COOKIE_SECURE === "true" || nodeEnv === "production",
  };
}

function parseFocusTimeout(value) {
  const timeoutMs = Number.parseInt(value || "5000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("FOCUS_NFE_TIMEOUT_MS deve ser um inteiro entre 100 e 30000.");
  }
  return timeoutMs;
}

export function getFocusNfeConfig(env = process.env) {
  const token = env.FOCUS_NFE_TOKEN?.trim() || "";
  const defaultBaseUrl = env.NODE_ENV === "production"
    ? FOCUS_NFE_ENVIRONMENTS.production
    : FOCUS_NFE_ENVIRONMENTS.homologation;
  const rawBaseUrl = env.FOCUS_NFE_BASE_URL?.trim() || defaultBaseUrl;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const environment = Object.entries(FOCUS_NFE_ENVIRONMENTS).find(([, url]) => url === baseUrl)?.[0];

  if (!environment) {
    throw new Error(
      "FOCUS_NFE_BASE_URL deve apontar exatamente para homologação ou produção. Consulte .env.example.",
    );
  }

  return {
    baseUrl,
    environment,
    isConfigured: token.length > 0,
    timeoutMs: parseFocusTimeout(env.FOCUS_NFE_TIMEOUT_MS),
    token,
  };
}

function parseDataForSeoTaskTimeout(value) {
  const timeoutMs = Number.parseInt(value || "120000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 240_000) {
    throw new Error("DATAFORSEO_TASK_TIMEOUT_MS deve ser um inteiro entre 30000 e 240000.");
  }
  return timeoutMs;
}

function parseDataForSeoTimeout(value) {
  const timeoutMs = Number.parseInt(value || "15000", 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("DATAFORSEO_TIMEOUT_MS deve ser um inteiro entre 100 e 30000.");
  }
  return timeoutMs;
}

export function getDataForSeoConfig(env = process.env) {
  const login = env.DATAFORSEO_LOGIN?.trim() || "";
  const password = env.DATAFORSEO_PASSWORD?.trim() || "";
  return {
    login,
    password,
    locationCode: 2076,
    languageCode: "pt-BR",
    isConfigured: Boolean(login && password),
    marketplace: "Google Shopping",
    missingEnvironmentVariables: [
      ...(!login ? ["DATAFORSEO_LOGIN"] : []),
      ...(!password ? ["DATAFORSEO_PASSWORD"] : []),
    ],
    timeoutMs: parseDataForSeoTimeout(env.DATAFORSEO_TIMEOUT_MS),
    taskTimeoutMs: parseDataForSeoTaskTimeout(env.DATAFORSEO_TASK_TIMEOUT_MS),
  };
}

export function getMarketConfig(env = process.env) {
  const type = (env.MARKET_PROVIDER?.trim().toLowerCase() || "dataforseo");
  if (type === "postgres") {
    return {
      type,
      provider: "PostgreSQL Catalog",
      marketplace: "Catálogo local",
      isConfigured: true,
      missingEnvironmentVariables: [],
    };
  }
  if (type === "dataforseo") return { ...getDataForSeoConfig(env), type, provider: "DataForSEO" };
  throw new Error("MARKET_PROVIDER deve ser postgres ou dataforseo.");
}

export function marketHealth(config) {
  return {
    provider: config.provider || "DataForSEO",
    marketplace: config.marketplace || "Google Shopping",
    configured: config.isConfigured === true,
  };
}

export function getAiAssistantConfig(env = process.env) {
  const apiKey = env.GEMINI_API_KEY?.trim() || "";
  const provider = env.AI_PROVIDER?.trim() || "gemini";
  const model = env.AI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const fillMode = env.AI_FILL_MODE?.trim() || "complete";
  const timeoutMs = Number(env.AI_TIMEOUT_MS || "25000");
  const validTimeout = Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 60_000;
  const configurationErrors = [];
  if (!apiKey) configurationErrors.push("GEMINI_API_KEY_MISSING");
  if (provider !== "gemini") configurationErrors.push("AI_PROVIDER_UNSUPPORTED");
  if (!/^gemini-[a-zA-Z0-9.-]{1,80}$/.test(model)) configurationErrors.push("AI_MODEL_INVALID");
  if (!["complete", "partial"].includes(fillMode)) configurationErrors.push("AI_FILL_MODE_INVALID");
  if (!validTimeout) configurationErrors.push("AI_TIMEOUT_INVALID");
  // An optional feature with missing/invalid configuration cannot stop the manual simulator.
  return {
    apiKey, provider, model, fillMode,
    timeoutMs: validTimeout ? timeoutMs : 25_000,
    isConfigured: configurationErrors.length === 0,
    configurationErrors,
  };
}

// Presence/format checks only. Never serialize the config object or probe the paid API here.
export function aiAssistantHealth(config) {
  const validModel = !config.configurationErrors.includes("AI_MODEL_INVALID")
    && config.model !== config.apiKey;
  return {
    provider: config.provider === "gemini" ? "gemini" : "unsupported",
    configured: config.isConfigured === true,
    model: validModel ? config.model : null,
    fillMode: config.fillMode,
    timeoutMs: config.timeoutMs,
    apiVersion: "v1beta",
    method: "generateContent",
    structuredOutput: "generationConfig.responseMimeType+responseJsonSchema",
    configurationErrors: [...config.configurationErrors],
  };
}

export function deploymentHealth(env = process.env) {
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return { commit: /^[a-f0-9]{40}$/i.test(commit) ? commit.toLowerCase() : null };
}
