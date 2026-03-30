# Assets Públicos Legados

## Papel da pasta
`public` reúne assets estáticos servidos diretamente pelo backend. Ela sustenta a camada legada renderizada no servidor e alguns recursos operacionais.

## O que existe hoje
- `css/`, `js/`, `fonts/`, `imgs/`, `lang/`: assets de interface.
- `notification/`: scripts relacionados a push.
- `uploads/` e `profiles/`: arquivos estáticos acessíveis em runtime.
- `manifest.json`, `sw.js`, `theme.js`, `qztrayFunctions.js` e scripts gerais.

## Relação com o sistema
- O servidor expõe esta pasta via `express.static`.
- Parte do conteúdo atende páginas Handlebars/HTML legadas.
- Parte sustenta integração operacional, como notificações e impressão.

## Regras
- Tratar esta pasta como legado ativo e operacional.
- Evitar colocar novos assets do frontend Vue aqui, salvo quando houver necessidade explícita de servir algo pelo backend.
- Antes de remover arquivos, verificar dependências em `views` e em fluxos de notificação/impressão.
