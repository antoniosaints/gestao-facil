import { Request, Response } from "express";
import { gerarPdfOrdemServico } from "./relatorios/ordens";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";

const db = prisma as any;

export async function gerarPdfOS(req: Request, res: Response): Promise<any> {
  try {
    const { id } = req.params;
    const { withPix, semAssinatura, cobrancaId } = req.query;
    const pix = withPix ? true : false;
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUnique({
      where: {
        id: customData.contaId,
      },
      include: {
        ParametrosConta: true,
      }
    });
    const ordem = await prisma.ordensServico.findUnique({
      where: { id: Number(id), contaId: customData.contaId },
      include: {
        Cliente: true,
        Operador: true,
        ItensOrdensServico: true,
      },
    });

    if (!conta) {
      throw new Error("Conta nao encontrada.");
    }
    if (!ordem) {
      throw new Error("Ordem nao encontrada.");
    }
    const ourive = await db.ouriveOrdem.findFirst({
      where: { contaId: customData.contaId, ordemServicoId: ordem.id },
      select: { id: true },
    });
    const imagensOurive = ourive
      ? await (async () => {
          const pecas = await db.ourivePeca.findMany({
            where: { ordemOuriveId: ourive.id },
            select: { id: true, descricao: true, codigoRastreio: true },
          });
          const fotos = await db.ourivePecaFoto.findMany({
            where: { pecaId: { in: pecas.map((peca: any) => peca.id) } },
            orderBy: { id: "asc" },
          });
          return fotos.map((foto: any) => {
            const peca = pecas.find((item: any) => item.id === foto.pecaId);
            return {
              url: foto.url,
              descricao: foto.descricao || peca?.descricao || peca?.codigoRastreio || "Peça",
            };
          });
        })()
      : [];

    // Config global da conta oculta a assinatura por padrão; a query permite
    // sobrescrever pontualmente na hora de gerar (forçar mostrar/ocultar).
    const ocultarPadrao =
      (conta.ParametrosConta?.[0] as any)?.osOcultarAssinatura ?? false;
    let mostrarAssinatura = !ocultarPadrao;
    if (semAssinatura === "true") mostrarAssinatura = false;
    else if (semAssinatura === "false") mostrarAssinatura = true;

    // Exportar com a cobrança PIX vinculada: usa o copia e cola da cobrança
    // (ex.: Mercado Pago) em vez da chave PIX estática.
    let cobrancaPixCopiaCola: string | null = null;
    if (cobrancaId) {
      const cobranca = await prisma.cobrancasFinanceiras.findFirst({
        where: {
          id: Number(cobrancaId),
          ordemServicoId: ordem.id,
          contaId: customData.contaId,
        },
      });
      cobrancaPixCopiaCola = (cobranca as any)?.pixCopiaCola ?? null;
      if (!cobrancaPixCopiaCola) {
        throw new Error(
          "A cobrança vinculada não possui um código PIX copia e cola disponível."
        );
      }
    }

    await gerarPdfOrdemServico(
      {
        Cliente: ordem.Cliente,
        Empresa: conta,
        Ordem: ordem,
        imagens: imagensOurive,
      },
      res,
      pix,
      mostrarAssinatura,
      cobrancaPixCopiaCola
    );
  } catch (err) {
    console.log(err);
    handleError(res, err);
  }
}
