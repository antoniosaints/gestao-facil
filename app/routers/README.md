# Routers

## Papel da pasta
`routers` organiza os endpoints HTTP por domínio e compõe a API principal do sistema.

## Ponto central
- `api.ts` monta `RouterMain` e registra os módulos principais.
- `default.ts` concentra rotas transversais como login, renovação de token, webhooks e push.

## Domínios atuais
- `whatsapp`
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
- No domínio `lancamentos`, o router também concentra endpoints operacionais de parcelas, dashboards, cobrança, importação/exportação CSV do financeiro, edição rápida de metadados do lançamento, detalhe de contas financeiras, transferência entre contas, ajuste manual de saldo da conta e o subdomínio `assinaturas-pagar` com CRUD, geração manual de lançamento recorrente e listagens desktop/mobile.

## Regras
- Novos endpoints devem entrar no router do domínio correspondente.
- Rotas transversais devem ser exceção, não regra.
- Manter nomes e agrupamentos coerentes com o frontend, que consome a API por domínio.
