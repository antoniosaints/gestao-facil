# Services

## Papel da pasta
`services` concentra integrações, enfileiramento e regras especializadas que precisam ser reaproveitadas fora de um único controller.

## O que existe hoje
- Integrações financeiras e gateways.
- Regras reutilizáveis de lançamentos financeiros, parcelamento configurável, atualização em cascata de parcelas, cálculo compartilhado do saldo realizado por conta e suporte à geração financeira de transferências/ajustes operacionais entre contas.
- `services/metas/metaCalculationService.ts` calcula metas por período; metas financeiras podem limitar o cálculo a várias categorias do próprio tenant e, na métrica de quantidade com categorias, contam lançamentos quitados uma única vez.
- Push notifications e filas.
- QR Code e barcode.
- Importação em lote de produtos.
- Importação em lote de lançamentos financeiros por CSV.
- Cache Redis.
- Integrações S3/R2 e storage público com fallback local.
- Integração W-API/WhatsApp, incluindo cliente HTTP, gestão de instâncias, prévia/sincronização de webhooks por callback, envio de mensagens e processamento idempotente de webhooks.
- Serviços específicos de `arena`.
- O serviço de reservas também consolida, por período e `contaId`, KPIs de volume, confirmação, receita recebida, ticket médio, pendências, distribuição por status, série diária, rankings e próximas reservas para o painel do módulo.
- A configuração pública de reservas inclui `bookingWindow.minimumNoticeMinutes` e `bookingWindow.horizonDays`, permitindo que o frontend limite o seletor de data sem substituir as validações de antecedência, horizonte e disponibilidade executadas pelo backend.
- Fachada da Loja Virtual em `services/loja`: política de módulo, tema público, autenticação/sessões de clientes, reserva e consumo transacional de estoque, idempotência, checkout e ciclo de pedidos.
- `services/restaurante/pricing.ts` concentra sabores e frete fixo; `deliveryZone.ts` resolve cobertura; `payment.ts` integra Pix/Checkout Pro; `catalogQuery.ts` mantém o contrato de grupos com opções ativas usado pelo catálogo privado. `customerAuth.ts` emite e valida JWT de audiência `restaurante-cliente`, normaliza telefone e resolve a conta publicada antes de autenticar o cliente. `production.ts` despacha cada categoria para um único ponto produtor ativo, rejeita roteamento ambíguo, pode exigir destino para todos os itens internos e deriva o estado global apenas dos pontos obrigatórios. `printing.ts` renderiza o ticket térmico, cria um trabalho deduplicado por saída simultânea e controla lease, retentativa e fallback individual. `catalogPolicy.ts` valida os grupos.
- A política `services/contas/menuVisibilityPolicy.ts` deve espelhar as chaves do frontend; o Restaurante persiste `restaurante`, `restaurante:salao`, `restaurante:comandas`, `restaurante:kds`, `restaurante:impressao`, `restaurante:cardapio`, `restaurante:pedidos` e `restaurante:configuracoes` para não perder a seleção ao salvar a visibilidade da sidebar. `services/comandas/restaurantCommandLinks.ts` desfaz vínculos do salão antes da exclusão de uma comanda.
- Builders utilitários como `prismaDatatables.ts`.

## Convenção real
- Esta pasta não é a única dona da regra de negócio.
- Ela é mais usada para:
  - integrações externas;
  - processamento assíncrono;
  - utilidades operacionais;
  - regras reutilizadas por vários fluxos.

## Regras
- Criar service quando a lógica for compartilhada, operacional ou ligada a integração externa.
- Não forçar extrações artificiais só para obedecer uma arquitetura que o projeto não usa por completo.
- Quando houver side effects externos, preferir mantê-los concentrados aqui.
- Webhooks de gateway da loja apenas confirmam pagamento/reserva; o débito físico, a Venda e a Movimentação de Estoque pertencem exclusivamente ao despacho idempotente.
rquitetura que o projeto não usa por completo.
- Quando houver side effects externos, preferir mantê-los concentrados aqui.
