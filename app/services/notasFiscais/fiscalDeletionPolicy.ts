import type { Prisma } from "../../../generated";

export const DELETED_FISCAL_STATUS = "EXCLUIDA";
const unsentStatuses = ["PENDENTE", "PRONTA_PARA_EMISSAO"];
const forbiddenCstat = [
  "100",
  "150",
  "110",
  "204",
  "301",
  "302",
  "303",
  "539",
  "999",
];
export function canDeleteFiscalDocument(invoice: any): boolean {
  if (
    !["NFE", "NFCE", "NFSE"].includes(invoice.tipo) ||
    ![...unsentStatuses, "REJEITADA"].includes(invoice.status)
  )
    return false;
  if (
    invoice.emitidaEm ||
    invoice.canceladaEm ||
    invoice.chaveAcesso ||
    invoice.protocolo ||
    invoice.codigoVerificacao ||
    invoice.xmlPath ||
    invoice.pdfPath
  )
    return false;
  if (
    invoice.Eventos?.some((event: any) =>
      ["PROCESSANDO", "PENDENTE", "EM_PROCESSAMENTO"].includes(event.status),
    )
  )
    return false;
  const raw = invoice.respostaJson;
  const response = Array.isArray(raw)
    ? raw[0]
    : raw?.data?.[0] || raw?.data || raw;
  if (
    response?.situacao === "sucesso" ||
    forbiddenCstat.includes(String(response?.cstat || ""))
  )
    return false;
  if (unsentStatuses.includes(invoice.status))
    return !invoice.idIntegracao && !invoice.provedorId && !response;
  // Falhas de transporte não comprovam uma rejeição fiscal. Exigimos a resposta do adaptador.
  if (
    /(conex|timeout|comunic|indispon|connection|ECONN|ETIMED|temporari|duplic|deneg|j[aá]\s+(?:foi\s+)?(?:autoriz|emitid|processad|convertid|registrad|exist|informad))/i.test(
      String(response?.mensagem || response?.message || ""),
    )
  )
    return false;
  if (invoice.provedor === "GERANET_NFSE") return response?.situacao === "erro";
  if (invoice.provedor === "GERANET_NFE")
    return (
      /^\d{3}$/.test(String(response?.cstat || "")) &&
      Number(response.cstat) >= 200
    );
  return ["REJEITADO", "REJEITADA"].includes(
    String(response?.status || response?.situacao || "").toUpperCase(),
  );
}

const deletionError = (code: string, message: string, status: number) =>
  Object.assign(new Error(message), { code, status });
export async function deleteFiscalDraft(
  tx: Pick<Prisma.TransactionClient, "notaFiscal" | "notaFiscalEvento">,
  contaId: number,
  id: number,
  userId: number,
) {
  const invoice = await tx.notaFiscal.findFirst({
    where: { id, contaId },
    include: { Eventos: true },
  });
  if (!invoice || invoice.status === DELETED_FISCAL_STATUS)
    throw deletionError(
      "fiscal_document_not_found",
      "Documento fiscal não encontrado.",
      404,
    );
  if (!canDeleteFiscalDocument(invoice))
    throw deletionError(
      "fiscal_delete_not_allowed",
      "Exclua apenas registros não enviados ou rejeições confirmadas, sem autorização, arquivos fiscais ou eventos em processamento.",
      409,
    );
  // Esta atualização disputa a mesma linha com a tomada de posse do worker. O perdedor não prossegue.
  const changed = await tx.notaFiscal.updateMany({
    where: {
      id,
      contaId,
      status: invoice.status,
      atualizadaEm: invoice.atualizadaEm,
      emitidaEm: null,
      canceladaEm: null,
      chaveAcesso: null,
      protocolo: null,
      codigoVerificacao: null,
      xmlPath: null,
      pdfPath: null,
      Eventos: {
        none: {
          status: { in: ["PROCESSANDO", "PENDENTE", "EM_PROCESSAMENTO"] },
        },
      },
    },
    data: { status: DELETED_FISCAL_STATUS, vendaId: null },
  });
  if (changed.count !== 1)
    throw deletionError(
      "fiscal_delete_conflict",
      "A nota foi atualizada ou começou a emitir. Atualize os detalhes antes de excluir.",
      409,
    );
  await tx.notaFiscalEvento.create({
    data: {
      notaFiscalId: id,
      tipo: "EXCLUSAO",
      status: "CONCLUIDO",
      processadoEm: new Date(),
      requisicaoJson: {
        userId,
        vendaId: invoice.vendaId,
        statusAnterior: invoice.status,
      },
      motivo:
        "Registro excluído e desvinculado da venda pelo usuário. Numeração preservada.",
    },
  });
  return { id, vendaId: invoice.vendaId, excluida: true };
}

export async function claimFiscalEmission(
  tx: Pick<Prisma.TransactionClient, "notaFiscal">,
  id: number,
) {
  const changed = await tx.notaFiscal.updateMany({
    where: {
      id,
      tipo: { in: ["NFE", "NFCE"] },
      status: { in: ["PENDENTE", "FALHA_REPROCESSAVEL"] },
    },
    data: { status: "EMITINDO" },
  });
  return changed.count === 1;
}
