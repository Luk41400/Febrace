# Pesquisa de mercado com DataForSEO Merchant Google Shopping

O navegador continua chamando somente a rota autenticada `GET /market/search?q=...`. O backend cria e consulta uma task da DataForSEO e devolve o mesmo contrato usado pelos cards, seleção de referência, histórico e ranking. O navegador não recebe o ID da task nem as credenciais.

## Endpoints e escolha

- `POST https://api.dataforseo.com/v3/merchant/google/products/task_post`
- `GET https://api.dataforseo.com/v3/merchant/google/products/task_get/advanced/{id}`
- Autenticação HTTP Basic com login e senha de **API Access**.
- Task com `keyword` (termo digitado), `location_code: 2076` (Brasil), `language_code: "pt-BR"`, `depth: 40` e `priority: 2` (alta).

A [Merchant Google Shopping Products](https://docs.dataforseo.com/v3/merchant/google/products/task_post/) consulta a página de produtos do Shopping, sendo mais fiel à integração anterior com `engine=google_shopping` que os blocos ocasionais `shopping` e `popular_products` da SERP orgânica. Ela só oferece modo Standard: a criação da task retorna um ID, e o [Task GET Advanced](https://docs.dataforseo.com/v3/merchant-google-products-task_get-advanced/) fornece os resultados quando estiverem prontos. O backend faz o polling sem alterar a rota ou a interface. O retorno não é instantâneo: a [DataForSEO informa cerca de um minuto em média para alta prioridade](https://dataforseo.com/help-center/fastest-method-to-get-results), sem garantia por task. A prioridade alta custa mais que a normal.

O POST é cobrado por task; as leituras GET da mesma task são gratuitas por até 30 dias, conforme a documentação do Task GET. Não existe franquia mensal fixa desta integração, mas há cobrança por uso, limites técnicos e possíveis limites de custo definidos na conta. Nem o site nem esta documentação descrevem a pesquisa como ilimitada.

## Normalização

O backend usa os itens `google_shopping_serp` e os produtos de `google_shopping_carousel` e `google_shopping_sponsored_carousel`. Só entram produtos com título, vendedor, preço positivo, `currency: "BRL"` e URL HTTPS. O campo `shopping_url` é usado quando disponível; quando a resposta omite os URLs e fornece um `product_id` numérico, o backend monta a URL da página do produto no Google Shopping conforme o formato dos exemplos oficiais de Product Info. Links ausentes sem identificador verificável são descartados. O primeiro URL HTTPS de `product_images` fornece a imagem, quando existe. `product_rating` e `reviews_count` ou `votes_count` fornecem os dados opcionais de avaliação.

O contrato interno preservado é `id`, `title`, `price`, `currency`, `source`, `seller`, `image`, `url`, `consultedAt` e, quando válidos, `rating` e `reviews`. `normalizeMarketQuery()`, `simplifyMarketQuery()` e `rankMarketResults()` permanecem iguais. A interface mostra até cinco referências e calcula estatísticas apenas a partir delas.

## Polling, cache e custo

A primeira task usa profundidade 40, incluída na primeira faixa de cobrança da Merchant API. O backend consulta seu ID imediatamente e depois a cada 2 segundos, no máximo 60 vezes e dentro de um prazo total de 120 segundos por padrão. `40601` e `40602` (task recebida/em fila) e resultado ainda nulo são tratados como pendentes. Quando o cliente encerra a requisição, o polling e a conexão HTTP em andamento são cancelados; uma task já criada pode continuar no provedor e ainda ter custo. O ID pendente fica em memória por até 30 minutos para uma tentativa posterior reutilizá-lo, inclusive após timeout ou desconexão. Instâncias diferentes da Vercel não compartilham esse estado.

Resultados com produtos ficam em cache na memória da instância por cinco minutos; respostas vazias, por um minuto. Requisições simultâneas idênticas na mesma instância compartilham a task e o polling, inclusive se uma solicitar atualização. Cada solicitante pode cancelar sua própria espera; a pesquisa compartilhada só é abortada quando todos saem. O botão “Atualizar resultados” ignora o cache concluído. A resposta do backend mantém `Cache-Control: no-store`.

Quando a primeira resposta tem menos de cinco produtos principais relevantes, o backend só cria uma segunda task se `simplifyMarketQuery()` mudar o termo e restarem pelo menos 60 segundos do prazo. Não consulta a mesma página novamente. Uma task adicional pode gerar outra cobrança. O limite local do Express de 30 pesquisas por minuto e seis atualizações por minuto por cliente continua protegendo o site contra abuso; não é franquia mensal da DataForSEO.

Logs registram somente provedor, status, duração, contagens e cache. A rota distingue configuração ausente (`503`), consulta inválida (`400`), autenticação (`401`), permissão (`403`), limite externo (`429`), resposta inválida (`502`), indisponibilidade (`5xx`) e timeout (`504`). O limite interno do Express usa `MARKET_RATE_LIMITED`; o limite da DataForSEO usa `MARKET_UPSTREAM_RATE_LIMITED`. Credenciais, corpo bruto e IDs de tasks não são enviados ao navegador.

## Configuração

Defina somente no backend, inclusive em **Vercel → Project Settings → Environment Variables**:

```text
DATAFORSEO_LOGIN=<login de API Access>
DATAFORSEO_PASSWORD=<senha de API Access>
DATAFORSEO_TIMEOUT_MS=15000
DATAFORSEO_TASK_TIMEOUT_MS=120000
```

O timeout HTTP é opcional (100–30000 ms); o prazo total é opcional (30000–240000 ms). A Function Node.js da Vercel aceita cancelamento de requisição por `supportsCancellation`. `GET /health` mostra apenas provedor, marketplace e presença de configuração; não testa credenciais nem cria task paga.

Para validação manual, depois de configurar credenciais reais, execute `pnpm dataforseo:check -- "iPhone 15 Pro Max"`. Essa chamada pode ser cobrada. `--variants` compara cinco termos e pode criar até dez tasks; use apenas se necessário. Os testes automatizados usam mocks e nunca chamam a API real.
