import { prisma } from "../../utils/prisma";
import { enqueuePushNotificationByPreference } from "./notificationPreferenceService";

/**
 * Verifica se algum dos produtos informados ficou com estoque igual ou abaixo
 * do minimo e, em caso positivo, dispara a notificacao push do evento
 * ESTOQUE_BAIXO (respeitando a preferencia da conta).
 *
 * Nunca lanca erro: notificacao nao pode quebrar o fluxo de venda.
 */
export async function checkLowStockAndNotify(
  contaId: number,
  produtoIds: Array<number | null | undefined>,
) {
  try {
    const ids = Array.from(
      new Set(produtoIds.filter((id): id is number => Boolean(id))),
    );

    if (!ids.length) {
      return false;
    }

    const produtos = await prisma.produto.findMany({
      where: {
        contaId,
        id: { in: ids },
        status: "ATIVO",
      },
      select: {
        nome: true,
        nomeVariante: true,
        estoque: true,
        minimo: true,
      },
    });

    const emBaixa = produtos.filter(
      (produto) => produto.estoque <= produto.minimo,
    );

    if (!emBaixa.length) {
      return false;
    }

    const nomes = emBaixa
      .map((produto) =>
        produto.nomeVariante && produto.nomeVariante !== "Padrão"
          ? `${produto.nome} / ${produto.nomeVariante} (${produto.estoque} un.)`
          : `${produto.nome} (${produto.estoque} un.)`,
      )
      .slice(0, 5);

    const extras = emBaixa.length - nomes.length;
    const lista = extras > 0 ? `${nomes.join(", ")} e mais ${extras}` : nomes.join(", ");

    await enqueuePushNotificationByPreference(
      "ESTOQUE_BAIXO",
      {
        title: "Estoque baixo!",
        body: `Produto(s) no estoque mínimo ou abaixo: ${lista}.`,
      },
      contaId,
    );

    return true;
  } catch (error) {
    console.warn(
      `[notifications] Falha ao verificar estoque baixo na conta ${contaId}`,
      error,
    );
    return false;
  }
}
