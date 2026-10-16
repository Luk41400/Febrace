import "dotenv/config";
import pg from "pg";
import { demoMarketProducts } from "../data/market-catalog-demo.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("O seed fictício não pode ser executado em produção.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não foi definida. Configure um PostgreSQL de desenvolvimento/teste.");
}

const databaseHost = new URL(process.env.DATABASE_URL).hostname;
const isLocalDatabase = ["localhost", "127.0.0.1", "[::1]", "database"].includes(databaseHost);
const isExplicitNeonTest = databaseHost.endsWith(".neon.tech")
  && process.env.MARKET_PROVIDER === "postgres"
  && process.env.MARKET_SEED_ALLOW_NEON_TEST === "1";
if (!isLocalDatabase && !isExplicitNeonTest) {
  throw new Error("O seed fictício aceita apenas PostgreSQL local; Neon de teste exige MARKET_SEED_ALLOW_NEON_TEST=1 e MARKET_PROVIDER=postgres.");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT to_regclass('public.market_catalog') AS catalog");
  if (!rows[0]?.catalog) throw new Error("Tabela market_catalog ausente. Execute pnpm migrate antes do seed.");
  if (isExplicitNeonTest) {
    const { rows: countRows } = await client.query("SELECT COUNT(*)::int AS total FROM market_catalog");
    if (countRows[0].total !== 0) {
      throw new Error("O catálogo Neon de teste deve estar vazio antes do seed fictício.");
    }
  }

  await client.query("BEGIN");
  try {
    for (const item of demoMarketProducts) {
      await client.query(`
        INSERT INTO market_catalog (
          id, title, description, category, price, currency, seller, source, image_url, product_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id, item.title, item.description, item.category, item.price,
        item.currency, item.seller, item.source, item.imageUrl, item.productUrl,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  console.log(`Seed concluído: ${demoMarketProducts.length} produtos fictícios disponíveis para desenvolvimento/teste.`);
} finally {
  await client.end();
}
