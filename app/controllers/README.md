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

## Importante
- No domínio `whatsapp`, os controllers validam permissão por nível, deixam o token bruto restrito ao backend e delegam a orquestração pesada ao service de WhatsApp para manter idempotência, isolamento por conta, prévia/sincronização de webhooks da W-API e emissão de Socket.IO.
- No domínio `loja`, `publica.ts` nunca recebe `contaId`: resolve a conta pelo slug, aplica capacidades do módulo e delega pedido/reserva à fachada. `pedidos.ts` usa exclusivamente `customData.contaId`, e `auth.ts` mantém a credencial do comprador separada de `Usuarios`.
- No domínio `restaurante`, respostas seguem `{ data, meta?, requestId }` e erros seguem `{ error: { code, message, details?, requestId } }`. O controller administra itens, grupos, zonas, mesas e pontos sempre pelo `contaId` autenticado; a listagem privada do cardápio inclui as opções ativas exigidas pelo Salão. Pedidos de mesa atualizam a comanda e despacham KDS/impressão na mesma transação, revertendo tudo com `production_route_missing` se qualquer item não tiver destino KDS ativo. O checkout público compartilha o recálculo e persiste snapshots; o cardápio público também entrega o tema da conta, e o acompanhamento protegido por token retorna status, totais e snapshots dos itens para compor o histórico no navegador. `restaurante/printing.ts` separa a administração autenticada dos endpoints de estação protegidos pelo token `X-Print-Station-Token`.
- A exclusão em `controllers/comandas` usa `services/comandas/restaurantCommandLinks.ts` antes de remover uma `ComandaOperacao`, evitando violação da FK do salão e encerrando de forma consistente sessões que ficariam sem comandas.
- Nem todo controller delega para um service.
- Em muitos fluxos, o controller é dono da orquestração e acessa Prisma diretamente.
- Isso é parte do padrão atual e a documentação deve refletir esse comportamento real.

## Regras
- Controllers devem continuar focados em um caso de uso claro.
- Ao reutilizar lógica pesada, preferir extrair para `services`, `helpers` ou `utils` sem esconder a convenção híbrida atual.
