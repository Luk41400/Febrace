import app from "./server.js";
import { getConfig } from "./lib/config.js";
import { pool, verifyDatabase } from "./lib/database.js";

const { port } = getConfig();
let server;

try {
  await verifyDatabase();
  server = app.listen(port, () => {
    console.log(`Assistente de Precificação disponível em http://localhost:${port}`);
  });
} catch (error) {
  console.error(`[startup] Não foi possível iniciar o servidor (${error.code || "DATABASE_ERROR"}).`);
  await pool.end();
  process.exitCode = 1;
}

export { server };
