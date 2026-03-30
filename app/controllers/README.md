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

## Importante
- Nem todo controller delega para um service.
- Em muitos fluxos, o controller é dono da orquestração e acessa Prisma diretamente.
- Isso é parte do padrão atual e a documentação deve refletir esse comportamento real.

## Regras
- Controllers devem continuar focados em um caso de uso claro.
- Ao reutilizar lógica pesada, preferir extrair para `services`, `helpers` ou `utils` sem esconder a convenção híbrida atual.
