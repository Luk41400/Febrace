# Provider PostgreSQL para pesquisa de mercado

Este modo usa um pool PostgreSQL exclusivo para `market_catalog`, configurado por `MARKET_DATABASE_URL`. Usuários, sessões e produtos salvos continuam usando `DATABASE_URL`. A rota autenticada `GET /market/search?q=...` e os cards permanecem os mesmos. Com `MARKET_PROVIDER=postgres`, o backend seleciona `PostgresMarketProvider` e não instancia nem chama DataForSEO. O valor padrão continua `dataforseo`.

## Preparação local

1. Configure `DATABASE_URL` para a aplicação principal, uma `SESSION_SECRET` válida e `MARKET_PROVIDER=postgres`. Configure `MARKET_DATABASE_URL` para um banco de catálogo separado quando houver; em desenvolvimento/teste, a ausência dela permite fallback para `DATABASE_URL`.
2. Prepare o banco de catálogo com `market_catalog` e seu índice. A migration `002_market_catalog.sql` criou a tabela no Neon de teste já validado. Migrations não são executadas pelo build ou pelo start; não execute migrations do catálogo contra o banco principal de produção.
3. Execute `pnpm market:seed` para inserir **28 produtos fictícios** de cadernos, canetas, mochilas, fones, mouses, teclados, garrafas e calculadoras.
4. Execute `pnpm start`, entre com uma conta local existente e pesquise pela interface normalmente.

O seed é idempotente no banco local e restrito a `NODE_ENV` diferente de `production`. Por padrão, aceita somente hosts locais (`localhost`, `127.0.0.1`, `::1` ou `database` no Docker Compose). Para validar em um **Neon de teste isolado**, confirme primeiro que a URL aponta para esse banco, que `MARKET_PROVIDER=postgres` e que `market_catalog` está vazia; então execute `pnpm market:seed` com `MARKET_SEED_ALLOW_NEON_TEST=1` somente nesse comando. O script recusa outros hosts remotos e catálogos Neon não vazios. Os títulos, lojas, preços, imagens e URLs `example.com` são **fictícios**. Eles comprovam apenas o fluxo técnico; não devem ser apresentados como preços reais de mercado. O script não cria usuários.

## Pesquisa e resposta

`market_catalog` armazena `id`, título, descrição, categoria, preço BRL positivo, vendedor, origem, URL HTTPS do produto, URL HTTPS opcional da imagem, avaliação e quantidade de reviews opcionais, timestamps e `search_text` gerado pelo banco. O índice GIN usa `to_tsvector('simple', search_text)`. A coluna gerada remove acentos comuns do português sem instalar extensões. O provider separa a consulta em palavras normalizadas e usa `to_tsquery` com prefixos, de modo que a ordem das palavras não importa para a seleção SQL. A consulta é parametrizada. O ranking visual existente do frontend permanece ativo e privilegia palavras presentes no título.

Exemplos para verificar: `caderno`, `caderno universitário`, `mouse`, `mouse sem fio`, `mochila escolar`, `CADERNO UNIVERSITARIO`. Uma busca inexistente retorna `results: []` e a interface mostra “Nenhum produto encontrado”, sem tratá-la como erro. A resposta inclui `provider: "PostgreSQL Catalog"`, `marketplace: "Catálogo de mercado"` e até 20 resultados com `id`, `title`, `price`, `currency: "BRL"`, `source`, `seller`, `image`, `url`, `consultedAt` e, quando presentes, `rating` e `reviews`.

O provider mantém cache em memória por cinco minutos para resultados e um minuto para vazios. Consultas simultâneas iguais compartilham a mesma leitura SQL na mesma instância. `refresh=1` ignora o cache concluído. `/health` informa `market.configured: true` quando há conexão configurada e `market.catalogProducts` quando a tabela responde; a contagem é armazenada por um minuto. Em produção, `MARKET_DATABASE_URL` é obrigatória e não pode ser idêntica a `DATABASE_URL`. A autenticação e os limites do Express permanecem ativos.

## Limitações

- Não há atualização automática de preços. Para uso real, são necessários feeds autorizados de lojas, verificação de validade das ofertas e atualização periódica do catálogo.
- A pesquisa SQL aceita prefixos de palavras, mas o ranking atual do frontend exige palavras completas no título. Prefixos dentro de uma palavra e termos presentes somente na descrição ou categoria podem aparecer na resposta da API e ser ocultados na interface. Isso requer uma etapa posterior de ajuste do ranking, caso esses casos sejam importantes para uso real.
- Cache e deduplicação são por processo, como no provider DataForSEO; não são compartilhados entre instâncias.
- Os testes automatizados usam pools simulados e não fazem chamadas externas. O Neon de teste com 28 produtos foi validado por consultas reais; uma URL dedicada de produção ainda precisa ser configurada na Vercel.
