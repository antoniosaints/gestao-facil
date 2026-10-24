# Controllers

## Papel da pasta
`controllers` recebe a requisição HTTP e executa o caso de uso do endpoint. É uma camada forte nesta base.

## Padrão real
- Controllers são agrupados por domínio.
- Dentro do domínio, os arquivos costumam ser separados por tipo de resposta ou tela:
  - CRUD principal;
  - `table`;
  - `mobile`;
  - `hooks`;
  - `estatisticas`;
  - `dashboard`;
  - `webhook`;
  - `graficos`;
  - `relatorios`.

## Como o código costuma funcionar
- lê params, query, body e `customData` do request autenticado;
- consulta Prisma direto ou usa utilitários/serviços;
- responde com `ResponseHandler`, `res.json` ou `handleError`.
- O controller `servicos/resumo_os.ts` também fornece o painel agregado por período. Ordens canceladas não entram em valor, quantidade, ticket ou rankings; o total líquido considera itens multiplicados pela quantidade e subtrai o desconto da OS sem permitir resultado negativo.
- `notasFiscais/documentos.ts` entrega o relatório operacional e o painel fiscal agregado por período. O painel agrupa por status e tipo, calcula a série diária no banco e limita a fila de atenção a seis notas da conta autenticada.

## Importante
- No domínio `whatsapp`, os controllers validam permissão por nível, deixam o token bruto restrito ao backend e delegam a orquestração pesada ao service de WhatsApp para manter idempotência, isolamento por conta, prévia/sincronização de webhooks da W-API e emissão de Socket.IO.
- No domínio `loja`, `publica.ts` nunca recebe `contaId`: resolve a conta pelo slug, aplica capacidades do módulo e delega pedido/reserva à fachada. `pedidos.ts` usa exclusivamente `customData.contaId`, e `auth.ts` mantém a credencial do comprador separada de `Usuarios`.
- No domínio `restaurante`, respostas seguem `{ data, meta?, requestId }` e erros seguem `{ error: { code, message, details?, requestId } }`. O controller administra itens, grupos, zonas, mesas e pontos sempre pelo `contaId` autenticado; a listagem privada do cardápio inclui as opções ativas exigidas pelo Salão. Pedidos de mesa atualizam a comanda e despacham KDS/impressão na mesma transação, revertendo tudo com `production_route_missing` se qualquer item não tiver destino KDS ativo. O checkout público compartilha o recálculo e persiste snapshots; o cardápio público também entrega o tema da conta, e o acompanhamento protegido por token retorna status, totais e snapshots dos itens para compor o histórico no navegador. `restaurante/customer.ts` mantém cadastro/login por telefone, perfil, endereços e histórico da conta pública, sempre checando o `contaId` resolvido pelo slug. `restaurante/printing.ts` separa a administração autenticada dos endpoints de estação protegidos pelo token `X-Print-Station-Token`.
- No domínio `ourive`, `ourive.ts` orquestra edição dos dados gerais da OS, antecipação e forma de pagamento do cliente, snapshots de orçamento e exclusão administrativa com reversão transacional de estoque e sobras. `updateClientPayment` valida o contrato em `services/ourive/clientPaymentSchema.ts` e delega a gravação transacional a `clientPaymentService.ts`: substitui o total, isola por conta, impede alterações após faturamento e registra histórico. A entrega usa o método escolhido na receita e na parcela financeira. `ourivePdf.ts` gera o comprovante A4 ou cupom com identidade da empresa, dados da OS, peças e fotos identificadas.
- A exclusão em `controllers/comandas` usa `services/comandas/restaurantCommandLinks.ts` antes de remover uma `ComandaOperacao`, evitando violação da FK do salão e encerrando de forma consistente sessões que ficariam sem comandas.
- Nem todo controller delega para um service.
- Em muitos fluxos, o controller é dono da orquestração e acessa Prisma diretamente.
- Isso é parte do padrão atual e a documentação deve refletir esse comportamento real.

## Regras
- Controllers devem continuar focados em um caso de uso claro.
- Ao reutilizar lógica pesada, preferir extrair para `services`, `helpers` ou `utils` sem esconder a convenção híbrida atual.

## Cadastro guiado

`contas/onboarding.ts` atende config/prévia públicas validadas e devolve 400 com fieldErrors ou 409 ONBOARDING_CATALOG_CHANGED. `contas/cadastro.ts` valida onboarding opcional e delega a criação transacional a `createAccountWithOnboarding`; retorna usuário seguro (id/nome/email), preservando indicação, boas-vindas e cadastro legado. O cadastro guiado exige catalogVersion da prévia para detectar mudanças de preço/status antes de criar conta. Contrato completo no README do backend.
