import { Request, Response } from "express";
import { gerarCsvBase, importarProdutos } from "../../../services/produtos/upload_lote";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { hasPermission } from "../../../helpers/userPermission";

export function getCsvBase(req: Request, res: Response): void {
  const csv = gerarCsvBase();
  res.setHeader("Content-Disposition", "attachment; filename=produtos_base.csv");
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
}

export async function postImportarProdutos(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ erro: "Arquivo CSV é obrigatório." });
    return;
  }

  const customData = getCustomRequest(req).customData;

  const permission = await hasPermission(customData, 4);
  if (!permission) {
    res.status(403).json({ message: "Sem permissão para realizar essa operação." });
    return;
  }

  try {
    const resultado = await importarProdutos(req.file.path, customData.contaId);
    res.json({ sucesso: true, ...resultado });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao processar CSV." });
  }
}
