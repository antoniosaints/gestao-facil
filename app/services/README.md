# Services

## Papel da pasta
`services` concentra integrações, enfileiramento e regras especializadas que precisam ser reaproveitadas fora de um único controller.

## O que existe hoje
- Integrações financeiras e gateways.
- Regras reutilizáveis de lançamentos financeiros, parcelamento configurável e atualização em cascata de parcelas.
- Push notifications e filas.
- QR Code e barcode.
- Importação em lote de produtos.
- Importação em lote de lançamentos financeiros por CSV.
- Cache Redis.
- Integrações S3/R2.
- Serviços específicos de `arena`.
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
