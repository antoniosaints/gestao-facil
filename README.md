### Sistema de Estoque e Vendas usando Nodejs, Prisma e HTMX

Faça o clone do projeto

```bash
  git clone https://github.com/antoniosaints/gestao-facil.git
```
Entre na pasta do sistema e rode

```bash
npm install
```

Inicie o projeto

```bash
npm run dev
```
Acesse localhost:3000, hospede o sistema com NodeJS fazendo o build
```bash
npm run build
```
e depois hospede o frontend com o nginx.
defina as variaveis de ambiente no .env 
```bash
DATABASE_URL="mysql://USER:PASS@HOST:PORT/DATABASE?schema=SCHEMA"
JWT_SECRET="SEU_SECRET"
NODE_ENV="development"
REQUIRED_JWT="true"
VAPID_PUBLIC_KEY="SUA_PUBLIC_KEY_VAPID"
VAPID_PRIVATE_KEY="SUA_PRIVATE_KEY_VAPID"
REDIS_HOST="HOST_DO_REDIS"
REDIS_PORT=
REDIS_PASSWORD="SENHA_REDIS"
```
Gere a chave Vapid usando 
```bash
npx web-push generate-vapid-keys
```