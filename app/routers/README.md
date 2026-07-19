# Routers

## Papel da pasta
`routers` organiza os endpoints HTTP por domínio e compõe a API principal do sistema.

## Ponto central
- `api.ts` monta `RouterMain` e registra os módulos principais.
- `default.ts` concentra rotas transversais como login, renovação de token, webhooks e push.

## Domínios atuais
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

## Padrão de rota
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

## Regras
- Novos endpoints devem entrar no router do domínio correspondente.
- Rotas transversais devem ser exceção, não regra.
- Manter nomes e agrupamentos coerentes com o frontend, que consome a API por domínio.
