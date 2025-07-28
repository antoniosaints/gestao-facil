import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.contas.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nome: "Conta Geral do Sistema",
      email: "costaantonio883@gmail.com",
      data: new Date(),
      asaasCustomerId: "GERAL",
      valor: 0,
      categoria: "Geral",
    },
  });
  await prisma.usuarios.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nome: "Antonio Costa",
      email: "costaantonio883@gmail.com",
      senha: "V@sco123",
      permissao: "root",
      contaId: 1,
      pushReceiver: true,
      emailReceiver: true,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
