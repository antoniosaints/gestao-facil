import { Request, Response } from "express";
import { gerarPdfOrdemServico } from "./relatorios/ordens";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";

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
