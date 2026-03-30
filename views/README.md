# Views Legadas

## Papel da pasta
`views` contém templates renderizados no servidor com Handlebars e alguns arquivos HTML. É uma camada legada, mas ainda presente no runtime.

## Estrutura atual
- `layouts/`: shells principais e variantes de layout.
- `partials/`: blocos por domínio, componentes e trechos reutilizados.
- `deprecated/`: arquivos antigos já marcados como ultrapassados.

## Como interpretar esta pasta
- Ela não representa a direção principal da interface atual, que está no frontend Vue.
- Mesmo assim, o backend continua registrando `express-handlebars`, então esta área ainda faz parte da aplicação.

## Regras
- Tratar como legado suportado.
- Não remover ou simplificar sem confirmar se alguma rota, fluxo interno ou operação ainda depende desses templates.
- Se um fluxo migrar para Vue, atualizar esta documentação para refletir a descontinuação real.
