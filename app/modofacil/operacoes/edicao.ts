import { createHash } from "node:crypto";
import { addHours, subHours } from "date-fns";
import type { Prisma, PrismaClient } from "../../../generated";
import type { CustomData } from "../../helpers/getCustomRequest";
import type { atualizarVendaTx } from "../../services/vendas/vendaEdicaoService";
import type { atualizarOrdemTx } from "../../services/servicos/ordemEdicaoService";
import { vendaPatchSchema, ordemPatchSchema } from "./schemas";
import { ModoFacilError } from "../errors";
import { permissionLevels } from "../configuracao/service";

function canonical(value: any): any {
  if (value?.toJSON) return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const revisaoRegistro = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function assertEditorScope(session: CustomData, tipo: "venda" | "os", record: { vendedorId?: number | null }, newOwner?: number | null) {
  if (tipo === "venda" && (permissionLevels[session.permissao] ?? 0) < 3 && (record.vendedorId !== session.userId || (newOwner !== undefined && newOwner !== session.userId))) {
    throw new ModoFacilError(403, "forbidden", "Você pode editar somente suas próprias vendas.");
  }
}

export async function carregarEdicao(db: Pick<PrismaClient, "vendas" | "ordensServico">, contaId: number, id: number, tipo: "venda" | "os") {
  const registro = tipo === "venda"
    ? await db.vendas.findFirst({ where: { id, contaId }, include: {
      ItensVendas: { orderBy: { id: "asc" } }, ComboSaidas: { orderBy: { id: "asc" } },
      LancamentoFinanceiro: { select: { id: true, status: true }, orderBy: { id: "asc" } },
      CobrancasFinanceiras: { select: { id: true, status: true }, orderBy: { id: "asc" } },
      NotaFiscals: { select: { id: true, status: true }, orderBy: { id: "asc" } },
    } })
    : await db.ordensServico.findFirst({ where: { id, contaId }, include: {
      ItensOrdensServico: { orderBy: { id: "asc" } }, ComboSaidas: { orderBy: { id: "asc" } },
      CobrancasFinanceiras: { select: { id: true, status: true }, orderBy: { id: "asc" } },
    } });
  if (!registro) throw new ModoFacilError(404, "operation_not_found", "Operação não encontrada nesta conta.");
  return { revisao: revisaoRegistro(registro), registro };
}

type EditPorts = {
  venda: (tx: Prisma.TransactionClient, id: number, data: Parameters<typeof atualizarVendaTx>[2], session: CustomData) => Promise<unknown>;
  os: (tx: Prisma.TransactionClient, id: number, data: Parameters<typeof atualizarOrdemTx>[2], session: CustomData) => Promise<unknown>;
  hasCombos(contaId: number): Promise<boolean>;
};

export async function validarReferenciasEdicao(tx: Prisma.TransactionClient, contaId: number, data: any) {
  if (data.clienteId && !(await tx.clientesFornecedores.findFirst({ where: { id: data.clienteId, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
  if (data.vendedorId && !(await tx.usuarios.findFirst({ where: { id: data.vendedorId, contaId, status: "ATIVO" }, select: { id: true } }))) throw new ModoFacilError(404, "user_not_found", "Responsável não encontrado.");
  for (const item of data.itens ?? []) {
    const where = { id: item.id, contaId };
    const found = item.tipo === "PRODUTO" ? await tx.produto.findFirst({ where, select: { id: true, saidas: true } })
      : item.tipo === "SERVICO" ? await tx.servicos.findFirst({ where, select: { id: true } })
      : await tx.combo.findFirst({ where: { ...where, ativo: true }, select: { id: true } });
    if (!found || ("saidas" in found && found.saidas === false)) throw new ModoFacilError(422, "invalid_item", "Item indisponível nesta conta.");
  }
}

export async function editarOperacao(db: PrismaClient, session: CustomData, id: number, tipo: "venda" | "os", input: unknown, ports: EditPorts) {
  const parsed = tipo === "venda" ? vendaPatchSchema.parse(input) : ordemPatchSchema.parse(input);
  return db.$transaction(async tx => {
    if (tipo === "venda") await tx.$queryRaw`SELECT id FROM Vendas WHERE id = ${id} AND contaId = ${session.contaId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM OrdensServico WHERE id = ${id} AND contaId = ${session.contaId} FOR UPDATE`;
    const current = await carregarEdicao(tx, session.contaId, id, tipo);
    assertEditorScope(session, tipo, current.registro as { vendedorId?: number | null }, "vendedorId" in parsed ? parsed.vendedorId : undefined);
    if (parsed.revisao !== current.revisao) throw new ModoFacilError(409, "version_conflict", "A operação mudou em outra sessão. Recarregue antes de editar.");
    const record = current.registro as any;
    if (record.faturado || ["FATURADO", "FATURADA"].includes(record.status)) throw new ModoFacilError(409, "already_invoiced", "Estorne o faturamento antes de editar.");
    const { revisao, ...patch } = parsed;
    const onlyNotes = Object.keys(patch).every(key => ["observacoes", "descricao", "descricaoCliente"].includes(key));
    const hasFinance = record.LancamentoFinanceiro?.length || record.CobrancasFinanceiras?.some((c: any) => ["PENDENTE", "EFETIVADO"].includes(c.status)) || record.NotaFiscals?.length;
    if (hasFinance && !onlyNotes) throw new ModoFacilError(409, "linked_finance", "Regularize vínculos financeiros/fiscais antes de alterar esta operação.");
    const recalculate = "itens" in patch || "desconto" in patch;
    if (!recalculate) {
      // Notes/status/header patch never recreates items or stock movements.
      await validarReferenciasEdicao(tx, session.contaId, patch);
      if (tipo === "venda") {
        const data = patch as Omit<ReturnType<typeof vendaPatchSchema.parse>, "revisao" | "itens">;
        const { vendedorId, data: date, ...fields } = data;
        await tx.vendas.updateMany({ where: { id, contaId: session.contaId }, data: { ...fields, ...(vendedorId !== undefined ? { vendedorId } : {}), ...(date ? { data: addHours(new Date(date), 3) } : {}) } });
      } else {
        const data = patch as Omit<ReturnType<typeof ordemPatchSchema.parse>, "revisao" | "itens">;
        const { vendedorId, data: date, garantia, ...fields } = data;
        await tx.ordensServico.updateMany({ where: { id, contaId: session.contaId }, data: { ...fields, ...(vendedorId !== undefined ? { operadorId: vendedorId } : {}), ...(date ? { data: addHours(new Date(date), 3) } : {}), ...(garantia !== undefined ? { garantia: String(garantia) } : {}) } });
      }
    } else if (tipo === "venda") {
      const data = patch as Omit<ReturnType<typeof vendaPatchSchema.parse>, "revisao">;
      const items = data.itens ?? [
        ...record.ItensVendas.map((item: any) => ({ id: item.produtoId ?? item.servicoId, tipo: item.produtoId ? "PRODUTO" : "SERVICO", nome: item.itemName ?? "Item", preco: Number(item.valor), quantidade: item.quantidade })),
        ...record.ComboSaidas.map((item: any) => ({ id: item.comboId, tipo: "COMBO", nome: item.nomeSnapshot, preco: Number(item.precoUnitarioSnapshot), quantidade: item.quantidade })),
      ];
      if (items.some((i: any) => i.tipo === "COMBO") && !(await ports.hasCombos(session.contaId))) throw new ModoFacilError(403, "combos_module_inactive", "O app Combos precisa estar ativo.");
      await validarReferenciasEdicao(tx, session.contaId, { ...data, itens: items });
      await ports.venda(tx, id, {
        data: data.data ? new Date(data.data) : subHours(record.data, 3), clienteId: data.clienteId !== undefined ? data.clienteId : record.clienteId,
        vendedorId: data.vendedorId !== undefined ? data.vendedorId : record.vendedorId,
        observacoes: data.observacoes ?? record.observacoes ?? undefined,
        garantia: data.garantia ?? record.garantia ?? undefined, desconto: data.desconto ?? Number(record.desconto),
        comandaId: record.comandaId, status: data.status ?? record.status, itens: items, pagamento: "OUTRO", tipoDocumentoFiscal: "NENHUM",
      }, session);
      // These fields are nullable in storage but not in the full legacy form.
      if (data.observacoes === null || data.garantia === null || data.vendedorId === undefined) await tx.vendas.updateMany({ where: { id, contaId: session.contaId }, data: {
        ...(data.observacoes === null ? { observacoes: null } : {}), ...(data.garantia === null ? { garantia: null } : {}),
        ...(data.vendedorId === undefined ? { vendedorId: record.vendedorId } : {}),
      } });
    } else {
      const data = patch as Omit<ReturnType<typeof ordemPatchSchema.parse>, "revisao">;
      const items = data.itens ?? [
        ...record.ItensOrdensServico.map((item: any) => ({ id: item.produtoId ?? item.servicoId, tipo: item.tipo, nome: item.itemName, valor: Number(item.valor), quantidade: item.quantidade })),
        ...record.ComboSaidas.map((item: any) => ({ id: item.comboId, tipo: "COMBO", nome: item.nomeSnapshot, valor: Number(item.precoUnitarioSnapshot), quantidade: item.quantidade })),
      ];
      if (items.some((i: any) => i.tipo === "COMBO") && !(await ports.hasCombos(session.contaId))) throw new ModoFacilError(403, "combos_module_inactive", "O app Combos precisa estar ativo.");
      await validarReferenciasEdicao(tx, session.contaId, { ...data, itens: items });
      await ports.os(tx, id, {
        data: data.data ? new Date(data.data) : subHours(record.data, 3), clienteId: data.clienteId ?? record.clienteId,
        vendedorId: data.vendedorId ?? record.operadorId, descricao: data.descricao ?? record.descricao ?? undefined,
        descricaoCliente: data.descricaoCliente ?? record.descricaoCliente ?? undefined,
        garantia: data.garantia, desconto: data.desconto ?? Number(record.desconto), status: data.status ?? record.status, itens: items,
      }, session);
      await tx.ordensServico.updateMany({ where: { id, contaId: session.contaId }, data: {
        ...(data.garantia === undefined ? { garantia: record.garantia } : {}),
        ...(data.descricao === null ? { descricao: null } : {}), ...(data.descricaoCliente === null ? { descricaoCliente: null } : {}),
      } });
    }
    return carregarEdicao(tx, session.contaId, id, tipo);
  });
}
