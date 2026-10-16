# Provider PostgreSQL para pesquisa de mercado em desenvolvimento

Este modo usa o PostgreSQL já conectado ao Express. A rota autenticada `GET /market/search?q=...` e o frontend permanecem os mesmos. Com `MARKET_PROVIDER=postgres`, o backend seleciona `PostgresMarketProvider` e não instancia nem chama DataForSEO. O valor padrão continua `dataforseo`.

## Preparação local

1. Configure um PostgreSQL **local** em `DATABASE_URL`, uma `SESSION_SECRET` válida e `MARKET_PROVIDER=postgres` no `.env` local. Não altere variáveis da Vercel para este teste.
2. Execute `pnpm install --frozen-lockfile` e `pnpm migrate`. A migration `002_market_catalog.sql` cria a tabela e o índice; migrations não são executadas pelo build ou pelo start.
3. Execute `pnpm market:seed` para inserir **28 produtos fictícios** de cadernos, canetas, mochilas, fones, mouses, teclados, garrafas e calculadoras.
4. Execute `pnpm start`, entre com uma conta local existente e pesquise pela interface normalmente.

O seed é idempotente no banco local e restrito a `NODE_ENV` diferente de `production`. Por padrão, aceita somente hosts locais (`localhost`, `127.0.0.1`, `::1` ou `database` no Docker Compose). Para validar em um **Neon de teste isolado**, confirme primeiro que a URL aponta para esse banco, que `MARKET_PROVIDER=postgres` e que `market_catalog` está vazia; então execute `pnpm market:seed` com `MARKET_SEED_ALLOW_NEON_TEST=1` somente nesse comando. O script recusa outros hosts remotos e catálogos Neon não vazios. Os títulos, lojas, preços, imagens e URLs `example.com` são **fictícios**. Eles comprovam apenas o fluxo técnico; não devem ser apresentados como preços reais de mercado. O script não cria usuários.

## Pesquisa e resposta

`market_catalog` armazena `id`, título, descrição, categoria, preço BRL positivo, vendedor, origem, URL HTTPS do produto, URL HTTPS opcional da imagem, avaliação e quantidade de reviews opcionais, timestamps e `search_text` gerado pelo banco. O índice GIN usa `to_tsvector('simple', search_text)`. A coluna gerada remove acentos comuns do português sem instalar extensões. O provider separa a consulta em palavras normalizadas e usa `to_tsquery` com prefixos, de modo que a ordem das palavras não importa para a seleção SQL. A consulta é parametrizada. O ranking visual existente do frontend permanece ativo e privilegia palavras presentes no título.

Exemplos para verificar no ambiente local: `caderno`, `caderno universitário`, `mouse`, `mouse sem fio`, `mochila escolar`, `CADERNO UNIVERSITARIO`. Uma busca inexistente retorna `results: []`. A resposta inclui `provider: "PostgreSQL Catalog"`, `marketplace: "Catálogo local"` e até 20 resultados com `id`, `title`, `price`, `currency: "BRL"`, `source`, `seller`, `image`, `url`, `consultedAt` e, quando presentes, `rating` e `reviews`.

O provider mantém cache em memória por cinco minutos para resultados e um minuto para vazios. Consultas simultâneas iguais compartilham a mesma leitura SQL na mesma instância. `refresh=1` ignora o cache concluído. `/health` informa `market.configured: true` e `market.catalogProducts`; a contagem é armazenada por um minuto para evitar uma consulta a cada health check. A autenticação e os limites do Express permanecem ativos.

## Limitações

- Não há atualização automática de preços. Para uso real, são necessários feeds autorizados de lojas, verificação de validade das ofertas e atualização periódica do catálogo.
- A pesquisa SQL aceita prefixos de palavras, mas o ranking atual do frontend exige palavras completas no título. Prefixos dentro de uma palavra e termos presentes somente na descrição ou categoria podem aparecer na resposta da API e ser ocultados na interface. Isso requer uma etapa posterior de ajuste do ranking, caso esses casos sejam importantes para uso real.
- Cache e deduplicação são por processo, como no provider DataForSEO; não são compartilhados entre instâncias.
- Os testes automatizados usam um pool PostgreSQL simulado e não fazem chamadas externas. A execução contra um PostgreSQL local deve ser validada após `pnpm migrate` e `pnpm market:seed`.
