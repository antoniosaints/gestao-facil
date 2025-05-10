## Sistema de Estoque e Vendas usando Nodejs, Prisma e HTMX
  * O Sistema exige um Servidor Redis para integração das notificações PUSH

### Desenvolvimento

Faça o clone do projeto
```bash
  git clone https://github.com/antoniosaints/gestao-facil.git
```

Entre na pasta do sistema e rode
```bash
npm install
```

Gere a chave Vapid usando 
```bash
npx web-push generate-vapid-keys
```

Depois defina as variaveis de ambiente no .env 
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

Caso o banco seja novo, rode a migração do prisma
```bash
npx prisma migrate dev
```

Gere o output do prisma com (Se já rodou o comando de migrate, não é necessário)
```bash
npx prisma generate
```

Inicie o projeto

```bash
npm run dev && npm run worker:dev
```

Acesse localhost:3000

### Produção

Para subir a aplicação para produção, tenha um servidor com PM2 (de preferencia) e siga o passo a passo

Realize o build (Após fazer as configs de ambiente e instalar as dependencias, além de gerar o prisma generate)

```bash
npm run build
```

Copie os seguintes arquivos para a hospedagem
```bash
/dist
/generated
/public
.env
package.json
package-lock.json
```

Rode dentro do servidor de produção na pasta
```bash
npm install
```
Inicie a aplicação rodando
```bash
npm start
```

Para iniciar o servidor e também suba o Worker separadamente com 
```bash
npm run worker
```