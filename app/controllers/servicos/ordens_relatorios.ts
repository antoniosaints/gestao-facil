import { Request, Response } from "express";
import { gerarPdfOrdemServico } from "./relatorios/ordens";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";

export async function gerarPdfOS(req: Request, res: Response): Promise<any> {
 try {
     const { id } = req.params;
  const customData = getCustomRequest(req).customData;
  const conta = await prisma.contas.findUnique({
    where: {
      id: customData.contaId,
    },
  });
  const ordem = await prisma.ordensServico.findUnique({
    where: { id: Number(id), contaId: customData.contaId },
    include: {
      Cliente: true,
      Contas: true,
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
      Cliente: {
        nome: "Antonio",
      },
      Contas: {
        nomeFantasia: conta.nome,
      },
      data: new Date(),
      desconto: ordem.desconto,
      descricao: ordem.descricao,
      descricaoCliente: ordem.descricaoCliente,
      id: ordem.id,
      ItensOrdensServico: ordem.ItensOrdensServico,
      Uid: ordem.Uid,
      logoPath: conta?.profile as string, // opcional
    },
    res
  );
 } catch (err) {
     console.log(err);
     handleError(res, err);
 }
}
