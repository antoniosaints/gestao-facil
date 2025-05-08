### Sistema de Estoque e Vendas usando Nodejs, Prisma e HTMX

faça o clone do projeto

```bash
  git clone https://github.com/lucas-santos-dev/estoque-prisma.git
```
entre na pasta do backend e depois instale as dependencias

```bash
npm install
```

inicie o projeto

```bash
npm run dev
```
Acesse o arquivo index.html da raiz do projeto para acessar o sistema, hospede o backend com NodeJS fazendo o build
```bash
npm run build
```
e depois hospede o frontend com o nginx.
defina as variaveis de ambiente no .env do backend
```bash
DATABASE_URL="mysql://USER:PASS@HOST:PORT/DATABASE?schema=SCHEMA"
JWT_SECRET="SEU_SECRET"
NODE_ENV="development"
REQUIRED_JWT="true"
```