# Routers

## Papel da pasta
`routers` organiza os endpoints HTTP por domínio e compõe a API principal do sistema.

## Ponto central
- `api.ts` monta `RouterMain` e registra os módulos principais.
- `default.ts` concentra rotas transversais como login, renovação de token, webhooks e push.

## Domínios atuais
- `notasFiscais` (`/api/v1/notas-fiscais`): configuração por conta, NFS-e avulsa, documentos de vendas e homologação.
- `whatsapp`
- `informativos`
- `contas`
- `clientes`
- `produtos`
- `servicos`
- `vendas`
- `lancamentos`
- `gerencia`
- `administracao`
- `arena`
- `uploads`
- `impressao`
- `monitor`
- `loja`
- `restaurante`
- `ourive`

## Padrão de rota
- `GET /homologacao/geranet` valida somente o acesso à API Key; não transmite nota nem valida o certificado na SEFAZ ou prefeitura. `POST /homologacao/nfs-e/emitir` e `POST /homologacao/vendas/:vendaId/documentos` reutilizam os emissores existentes e exigem `ambiente = HOMOLOGACAO` salvo no servidor via `requireFiscalHomologacao`. O segundo aceita `tipo: NFE|NFCE` e uma venda faturada.
- `GET /vendas/sem-documento` aceita `pageSize`, `page`, `search`, `sortBy` e `order` para a `DataTable` fiscal; sem `pageSize`, preserva a lista simples com `limit`. `GET /vendas/sem-documento/select2` atende à busca assíncrona da homologação com `search` ou `id`. Ambas usam o tenant do JWT.
- `GET /vendas/:vendaId/cliente` informa o cliente vinculado e a validade do CPF/CNPJ; `PATCH /vendas/:vendaId/cliente` com `{ "clienteId": 123 }` vincula um cliente válido a uma venda faturada sem nota ativa, com permissão fiscal de escrita e isolamento por conta.
- O router de domínio define paths e middlewares.
- `authenticateJWT` protege quase toda a API privada.
- O router normalmente delega para controllers menores por caso de uso, por exemplo:
  - listagem;
  - tabela;
  - mobile;
  - estatísticas;
  - ações auxiliares.
- No domínio `whatsapp`, o router separa o webhook público `POST /api/whatsapp/webhooks/:instanceId` das rotas privadas protegidas por JWT para instâncias, conversas e mensagens. A sincronização com a W-API usa endpoints privados dedicados `GET/POST /api/whatsapp/instances/:id/webhooks`, antes da rota genérica de ações da instância.
- O domínio autenticado `informativos` expõe somente a consulta segmentada e as ações de leitura/dispensa do usuário. Criação, publicação, resolução e arquivamento ficam sob `/api/admin/informativos`, protegidos pelas regras do modo CEO.
- No domínio `loja`, `/api/loja/publica/:slug/*` expõe vitrine, produtos, checkout, pedidos e autenticação do comprador; `/api/loja/config` e `/api/loja/pedidos/*` exigem JWT do ERP e obtêm o tenant do contexto autenticado.
- No domínio `lancamentos`, o router também concentra endpoints operacionais de parcelas, dashboards, cobrança, importação/exportação CSV do financeiro, edição rápida de metadados do lançamento, detalhe de contas financeiras, transferência entre contas, ajuste manual de saldo da conta e o subdomínio `assinaturas-pagar` com CRUD, geração manual de lançamento recorrente e listagens desktop/mobile.
- No domínio `reservas`, `GET /api/reservas/painel` entrega a visão agregada por período para o dashboard autenticado, enquanto `GET /api/reservas` permanece responsável pela listagem operacional. Ambas as rotas usam a permissão `reservas:visualizar` e o tenant do JWT.
- O domínio versionado `restaurante` fica em `/api/v1/restaurante`. As rotas públicas por slug expõem cardápio, prévia e criação idempotente; as rotas privadas de catálogo, zonas, `/mesas`, `/sessoes-mesa`, `/pontos-producao`, `/kds`, `/estacoes-impressao`, `/regras-impressao` e `/trabalhos-impressao` usam JWT e `requireRestauranteAccess` com uma capacidade explícita. `/acesso` expõe as capacidades efetivas e `/usuarios-papeis` é restrito a gestores. Heartbeat, claim e ack em `/estacao-impressao` usam um token opaco exclusivo da estação.
- O domínio versionado `ourive` fica em `/api/v1/ourive`. A OS pode ser atualizada em `PATCH /ordens/:id`, o comprovante é exportado em `GET /ordens/:id/comprovante?formato=A4|CUPOM`, e a exclusão em `DELETE /ordens/:id` exige administrador e reverte o histórico de estoque quando ainda não há financeiro irreversível.
- O router legado `/api/comandas` continua responsável pelas operações de comanda, mas agora exige `COMANDAS_OPERAR`; na interface ele é acessado em `/restaurante/comandas`.
- No domínio `servicos`, `GET /api/servicos/ordens/dashboard/painel` concentra os KPIs, comparação com o período anterior, série diária, distribuição por status, rankings e fila operacional das ordens de serviço, sempre isolado pelo `contaId` autenticado.

## Regras
- Novos endpoints devem entrar no router do domínio correspondente.
- Rotas transversais devem ser exceção, não regra.
- Manter nomes e agrupamentos coerentes com o frontend, que consome a API por domínio.
