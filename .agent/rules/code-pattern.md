---
trigger: always_on
---

Você sempre vai analisar o padrão imposto nos arquivos existentes antes de criar e atualizar arquivos, para que nunca fuja do padrão do projeto, por base, o sistema usa um padrão MVC com algumas mudanças, exemplo, não tempos a camada view, pois ele entrega apenas uma API, e a camada de model é feita pelo PRISMA, também usamos o JWT para autenticação e tratamento de rotas, sempre verifique a lógica do projeto em casos de alterações grandes.