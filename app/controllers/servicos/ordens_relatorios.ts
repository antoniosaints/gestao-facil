import { Request, Response } from "express";
import { gerarPdfOrdemServico } from "./relatorios/ordens";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";

export async function gerarPdfOS(req: Request, res: Response): Promise<any> {
  try {
    const { id } = req.params;
    const { withPix } = req.query;
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

    await gerarPdfOrdemServico(
      {
        Cliente: ordem.Cliente,
        Empresa: conta,
        Ordem: ordem,
      },
      res,
      pix
    );
  } catch (err) {
    console.log(err);
    handleError(res, err);
  }
}
