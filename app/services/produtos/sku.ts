import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

function normalizarParteSku(texto: string | null | undefined, max: number): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, max);
}

/** Gera um SKU único por conta para uma variante de produto. */
export async function gerarSkuUnico(
  client: PrismaClientLike,
  contaId: number,
  nome: string,
  nomeVariante?: string | null
): Promise<string> {
  const parteNome = normalizarParteSku(nome, 6);
  const varianteNormalizada = normalizarParteSku(nomeVariante, 20);
  const parteVariante = varianteNormalizada && varianteNormalizada !== "PADRAO"
    ? normalizarParteSku(nomeVariante, 4)
    : "";
  const prefixo = [parteNome, parteVariante].filter(Boolean).join("-") || "SKU";

  for (let tentativa = 0; tentativa < 25; tentativa++) {
    const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
    const codigo = `${prefixo}-${sufixo}`;
    const existente = await client.produto.findFirst({
      where: { contaId, codigo },
      select: { id: true },
    });
    if (!existente) return codigo;
  }

  return `${prefixo}-${Date.now().toString(36).toUpperCase()}`;
}
