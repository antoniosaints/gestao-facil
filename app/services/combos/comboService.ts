import Decimal from "decimal.js";
import type { ComboCanal, Prisma } from "../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import type { ComboInput } from "../../schemas/combos";
import { assertAvailableAndDecrement, getReservedQuantity } from "../loja/lojaInventoryService";
import { contaHasActiveModule } from "../contas/storeModulesService";

type Transaction = Prisma.TransactionClient;

export class ComboError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const comboInclude = {
  componentes: {
    include: {
      Produto: { select: { id: true, contaId: true, nome: true, nomeVariante: true, preco: true, estoque: true, controlaEstoque: true, saidas: true, status: true } },
      Servico: { select: { id: true, contaId: true, nome: true, preco: true, status: true } },
    },
    orderBy: { ordem: "asc" as const },
  },
} satisfies Prisma.ComboInclude;

export type ComboWithComponents = Prisma.ComboGetPayload<{ include: typeof comboInclude }>;

async function assertComponents(contaId: number, input: ComboInput, tx: Transaction) {
  const productIds = input.componentes.filter((item) => item.tipo === "PRODUTO").map((item) => item.id);
  const serviceIds = input.componentes.filter((item) => item.tipo === "SERVICO").map((item) => item.id);
  const [products, services] = await Promise.all([
    tx.produto.findMany({ where: { contaId, id: { in: productIds } }, select: { id: true, nome: true, saidas: true, status: true } }),
    tx.servicos.findMany({ where: { contaId, id: { in: serviceIds } }, select: { id: true, nome: true, status: true } }),
  ]);
  if (products.length !== new Set(productIds).size || services.length !== new Set(serviceIds).size) {
    throw new ComboError("combo_component_not_found", "Um ou mais componentes não pertencem a esta conta.", 404);
  }
}

function componentCreate(input: ComboInput) {
  return input.componentes.map((item, ordem) => ({
    tipo: item.tipo,
    produtoId: item.tipo === "PRODUTO" ? item.id : null,
    servicoId: item.tipo === "SERVICO" ? item.id : null,
    quantidade: item.quantidade,
    ordem,
  }));
}

export async function createCombo(contaId: number, input: ComboInput) {
  return prismaTransaction(async (tx) => {
    await assertComponents(contaId, input, tx);
    return tx.combo.create({
      data: {
        contaId,
        Uid: gerarIdUnicoComMetaFinal("COM"),
        nome: input.nome,
        descricao: input.descricao || null,
        imagem: input.imagem || null,
        preco: new Decimal(input.preco),
        ativo: input.ativo,
        mostrarNoPdv: input.mostrarNoPdv,
        mostrarOnline: input.mostrarOnline,
        componentes: { create: componentCreate(input) },
      },
      include: comboInclude,
    });
  });
}

export async function updateCombo(contaId: number, id: number, input: ComboInput) {
  return prismaTransaction(async (tx) => {
    const current = await tx.combo.findFirst({ where: { id, contaId } });
    if (!current) throw new ComboError("combo_not_found", "Combo não encontrado.", 404);
    await assertComponents(contaId, input, tx);
    await tx.comboComponente.deleteMany({ where: { comboId: id, contaId } });
    return tx.combo.update({
      where: { id },
      data: {
        nome: input.nome,
        descricao: input.descricao || null,
        imagem: input.imagem || null,
        preco: new Decimal(input.preco),
        ativo: input.ativo,
        mostrarNoPdv: input.mostrarNoPdv,
        mostrarOnline: input.mostrarOnline,
        componentes: { create: componentCreate(input) },
      },
      include: comboInclude,
    });
  });
}

async function prismaTransaction<T>(fn: (tx: Transaction) => Promise<T>) {
  const { prisma } = await import("../../utils/prisma");
  return prisma.$transaction(fn);
}

export async function getCombo(contaId: number, id: number) {
  const { prisma } = await import("../../utils/prisma");
  const combo = await prisma.combo.findFirst({ where: { id, contaId }, include: comboInclude });
  if (!combo) throw new ComboError("combo_not_found", "Combo não encontrado.", 404);
  return combo;
}

export async function listCombos(contaId: number, args: { search?: string; page: number; limit: number; ativo?: boolean }) {
  const { prisma } = await import("../../utils/prisma");
  const where: Prisma.ComboWhereInput = {
    contaId,
    ativo: args.ativo,
    ...(args.search ? { OR: [{ nome: { contains: args.search } }, { Uid: { contains: args.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.combo.findMany({
      where,
      include: comboInclude,
      orderBy: { updatedAt: "desc" },
      skip: (args.page - 1) * args.limit,
      take: args.limit,
    }),
    prisma.combo.count({ where }),
  ]);
  return { items, total, page: args.page, limit: args.limit, totalPages: Math.ceil(total / args.limit) };
}

export async function deleteCombo(contaId: number, id: number) {
  const { prisma } = await import("../../utils/prisma");
  const combo = await prisma.combo.findFirst({ where: { id, contaId }, select: { id: true, _count: { select: { saidas: true } } } });
  if (!combo) throw new ComboError("combo_not_found", "Combo não encontrado.", 404);
  if (combo._count.saidas > 0) {
    throw new ComboError("combo_has_history", "Combo possui histórico e deve apenas ser inativado.", 409);
  }
  await prisma.combo.delete({ where: { id } });
}

export async function comboAvailability(tx: Transaction, combo: ComboWithComponents) {
  let available: number | null = null;
  let reason: string | null = null;
  for (const component of combo.componentes) {
    if (component.tipo === "SERVICO") {
      if (!component.Servico?.status) reason ||= `Serviço ${component.Servico?.nome || ""} inativo.`;
      continue;
    }
    const product = component.Produto;
    if (!product || product.status !== "ATIVO" || product.saidas === false) {
      reason ||= `Produto ${product?.nome || ""} indisponível.`;
      available = 0;
      continue;
    }
    if (!product.controlaEstoque) continue;
    const reserved = await getReservedQuantity(tx, combo.contaId, product.id);
    const units = Math.max(0, Math.floor((product.estoque - reserved) / component.quantidade));
    available = available === null ? units : Math.min(available, units);
    if (units === 0) reason ||= `Sem estoque de ${product.nome}.`;
  }
  return { disponivel: !reason && (available === null || available > 0), quantidadeDisponivel: available, motivoIndisponivel: reason };
}

export async function listComboOptions(contaId: number, channel: "PDV" | "VENDA" | "OS" | "COMANDA", search?: string) {
  const { prisma } = await import("../../utils/prisma");
  const combos = await prisma.combo.findMany({
    where: {
      contaId,
      ativo: true,
      ...(channel === "PDV" ? { mostrarNoPdv: true } : {}),
      ...(search ? { nome: { contains: search } } : {}),
    },
    include: comboInclude,
    orderBy: { nome: "asc" },
    take: 50,
  });
  return prisma.$transaction(async (tx) => Promise.all(combos.map(async (combo) => ({
    id: combo.id,
    label: combo.nome,
    nome: combo.nome,
    imagem: combo.imagem,
    preco: Number(combo.preco),
    tipo: "COMBO" as const,
    componentes: combo.componentes.map((item) => ({
      tipo: item.tipo,
      id: item.produtoId ?? item.servicoId,
      nome: item.Produto ? `${item.Produto.nome}${item.Produto.nomeVariante ? ` / ${item.Produto.nomeVariante}` : ""}` : item.Servico?.nome,
      quantidade: item.quantidade,
    })),
    ...(await comboAvailability(tx, combo)),
  }))));
}

export async function listPublicCombos(contaId: number, search?: string) {
  if (!(await contaHasActiveModule(contaId, "combos"))) return [];
  const { prisma } = await import("../../utils/prisma");
  const combos = await prisma.combo.findMany({
    where: {
      contaId,
      ativo: true,
      mostrarOnline: true,
      ...(search ? { nome: { contains: search } } : {}),
    },
    include: comboInclude,
    orderBy: { nome: "asc" },
    take: 100,
  });
  return prisma.$transaction(async (tx) => Promise.all(combos.map(async (combo) => ({
    id: combo.id,
    comboId: combo.id,
    itemType: "COMBO" as const,
    nome: combo.nome,
    name: combo.nome,
    descricao: combo.descricao,
    description: combo.descricao,
    categoria: "Combos",
    category: "Combos",
    imagem: combo.imagem,
    image: combo.imagem,
    preco: Number(combo.preco),
    price: Number(combo.preco),
    priceOriginal: null,
    variant: "Combo",
    baseId: null,
    unit: "combo",
    sku: combo.Uid,
    controlsStock: combo.componentes.some((item) => Boolean(item.Produto?.controlaEstoque)),
    soldCount: 0,
    componentes: combo.componentes.map((item) => ({
      tipo: item.tipo,
      id: item.produtoId ?? item.servicoId,
      nome: item.Produto ? `${item.Produto.nome}${item.Produto.nomeVariante ? ` / ${item.Produto.nomeVariante}` : ""}` : item.Servico?.nome,
      quantidade: item.quantidade,
    })),
    ...(await comboAvailability(tx, combo)),
  }))));
}

export function allocateComboComponentValues(
  total: Decimal.Value,
  weights: Decimal.Value[],
) {
  const decimalWeights = weights.map((weight) => new Decimal(weight));
  const totalWeight = decimalWeights.reduce((sum, item) => sum.add(item), new Decimal(0));
  const totalCents = new Decimal(total).mul(100).round().toNumber();
  let assigned = 0;
  return decimalWeights.map((weight, index) => {
    const cents = index === decimalWeights.length - 1
      ? totalCents - assigned
      : totalWeight.gt(0)
        ? new Decimal(totalCents).mul(weight).div(totalWeight).floor().toNumber()
        : Math.floor(totalCents / decimalWeights.length);
    assigned += cents;
    return new Decimal(cents).div(100);
  });
}

function allocateValues(combo: ComboWithComponents) {
  const weights = combo.componentes.map((item) => {
    const price = item.Produto?.preco ?? item.Servico?.preco ?? new Decimal(0);
    return new Decimal(price).mul(item.quantidade);
  });
  return allocateComboComponentValues(combo.preco, weights);
}

export type ComboLine = { id: number; quantidade: number };

export async function createComboVendaSaidas(
  tx: Transaction,
  args: { contaId: number; vendaId: number; canal: Extract<ComboCanal, "PDV" | "VENDA" | "LOJA">; clienteId?: number | null; lines: ComboLine[] },
) {
  if (!args.lines.length) return [];
  const ids = [...new Set(args.lines.map((line) => line.id))];
  const combos = await tx.combo.findMany({ where: { contaId: args.contaId, id: { in: ids }, ativo: true }, include: comboInclude });
  if (combos.length !== ids.length) throw new ComboError("combo_not_found", "Um ou mais combos não estão disponíveis.", 404);
  const comboMap = new Map(combos.map((combo) => [combo.id, combo]));
  const productTotals = new Map<number, { quantidade: number; nome: string }>();

  for (const line of args.lines) {
    const combo = comboMap.get(line.id)!;
    if (args.canal === "PDV" && !combo.mostrarNoPdv) throw new ComboError("combo_channel_unavailable", `${combo.nome} não está disponível no PDV.`);
    for (const component of combo.componentes) {
      if (component.tipo === "SERVICO" && !component.Servico?.status) throw new ComboError("combo_service_inactive", `O serviço ${component.Servico?.nome} está inativo.`);
      if (component.tipo === "PRODUTO") {
        const product = component.Produto;
        if (!product || product.status !== "ATIVO" || product.saidas === false) throw new ComboError("combo_product_blocked", `O produto ${product?.nome || ""} não permite saída.`);
        if (product.controlaEstoque) {
          const current = productTotals.get(product.id) || { quantidade: 0, nome: product.nome };
          current.quantidade += component.quantidade * line.quantidade;
          productTotals.set(product.id, current);
        }
      }
    }
  }

  for (const [produtoId, item] of [...productTotals.entries()].sort(([a], [b]) => a - b)) {
    await assertAvailableAndDecrement(tx, args.contaId, produtoId, item.quantidade);
  }

  const outputs = [];
  for (const [order, line] of args.lines.entries()) {
    const combo = comboMap.get(line.id)!;
    const allocated = allocateValues(combo);
    await tx.itensVendas.create({
      data: {
        vendaId: args.vendaId,
        itemName: combo.nome,
        produtoId: null,
        servicoId: null,
        quantidade: line.quantidade,
        valor: combo.preco,
      },
    });
    const output = await tx.comboSaida.create({
      data: {
        contaId: args.contaId,
        comboId: combo.id,
        vendaId: args.vendaId,
        canal: args.canal,
        nomeSnapshot: combo.nome,
        descricaoSnapshot: combo.descricao,
        imagemSnapshot: combo.imagem,
        precoUnitarioSnapshot: combo.preco,
        quantidade: line.quantidade,
        subtotal: new Decimal(combo.preco).mul(line.quantidade),
        ordem: order,
      },
    });
    for (const [index, component] of combo.componentes.entries()) {
      const totalQuantity = component.quantidade * line.quantidade;
      let movementId: number | null = null;
      let debitadoEm: Date | null = null;
      if (component.tipo === "PRODUTO" && component.Produto?.controlaEstoque) {
        const movement = await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            contaId: args.contaId,
            vendaId: args.vendaId,
            produtoId: component.Produto.id,
            quantidade: totalQuantity,
            custo: allocated[index],
            status: "CONCLUIDO",
            tipo: "SAIDA",
            clienteFornecedor: args.clienteId || null,
          },
        });
        movementId = movement.id;
        debitadoEm = new Date();
      }
      await tx.comboSaidaComponente.create({
        data: {
          contaId: args.contaId,
          comboSaidaId: output.id,
          tipo: component.tipo,
          produtoId: component.produtoId,
          servicoId: component.servicoId,
          nomeSnapshot: component.Produto
            ? `${component.Produto.nome}${component.Produto.nomeVariante ? ` / ${component.Produto.nomeVariante}` : ""}`
            : component.Servico!.nome,
          quantidadePorCombo: component.quantidade,
          quantidadeTotal: totalQuantity,
          valorUnitarioRateado: allocated[index],
          movimentacaoId: movementId,
          debitadoEm,
        },
      });
    }
    outputs.push(output);
  }
  return outputs;
}

export async function restoreComboVendaStock(tx: Transaction, contaId: number, vendaId: number) {
  const components = await tx.comboSaidaComponente.findMany({
    where: { contaId, ComboSaida: { vendaId }, produtoId: { not: null }, debitadoEm: { not: null }, devolvidoEm: null },
    orderBy: { produtoId: "asc" },
  });
  for (const item of components) {
    await tx.produto.update({ where: { id: item.produtoId! }, data: { estoque: { increment: item.quantidadeTotal } } });
    await tx.comboSaidaComponente.update({ where: { id: item.id }, data: { devolvidoEm: new Date() } });
  }
}

export async function createComboOrdemSaidas(
  tx: Transaction,
  args: { contaId: number; ordemServicoId: number; clienteId?: number | null; lines: ComboLine[] },
) {
  if (!args.lines.length) return [];
  const ids = [...new Set(args.lines.map((line) => line.id))];
  const combos = await tx.combo.findMany({ where: { contaId: args.contaId, id: { in: ids }, ativo: true }, include: comboInclude });
  if (combos.length !== ids.length) throw new ComboError("combo_not_found", "Um ou mais combos não estão disponíveis.", 404);
  const comboMap = new Map(combos.map((combo) => [combo.id, combo]));
  const totals = new Map<number, number>();
  for (const line of args.lines) {
    const combo = comboMap.get(line.id)!;
    for (const component of combo.componentes) {
      if (component.tipo === "SERVICO" && !component.Servico?.status) throw new ComboError("combo_service_inactive", `O serviço ${component.Servico?.nome} está inativo.`);
      if (component.tipo === "PRODUTO") {
        const product = component.Produto;
        if (!product || product.saidas === false || product.status !== "ATIVO") throw new ComboError("combo_product_blocked", `O produto ${product?.nome || ""} não permite saída.`);
        if (product.controlaEstoque) totals.set(product.id, (totals.get(product.id) || 0) + component.quantidade * line.quantidade);
      }
    }
  }
  for (const [productId, quantity] of [...totals.entries()].sort(([a], [b]) => a - b)) {
    await assertAvailableAndDecrement(tx, args.contaId, productId, quantity);
  }
  const outputs = [];
  for (const [order, line] of args.lines.entries()) {
    const combo = comboMap.get(line.id)!;
    const allocated = allocateValues(combo);
    await tx.itensOrdensServico.create({
      data: {
        ordemId: args.ordemServicoId,
        itemName: combo.nome,
        tipo: "SERVICO",
        produtoId: null,
        servicoId: null,
        quantidade: line.quantidade,
        valor: combo.preco,
      },
    });
    const output = await tx.comboSaida.create({
      data: {
        contaId: args.contaId,
        comboId: combo.id,
        ordemServicoId: args.ordemServicoId,
        canal: "OS",
        nomeSnapshot: combo.nome,
        descricaoSnapshot: combo.descricao,
        imagemSnapshot: combo.imagem,
        precoUnitarioSnapshot: combo.preco,
        quantidade: line.quantidade,
        subtotal: new Decimal(combo.preco).mul(line.quantidade),
        ordem: order,
      },
    });
    for (const [index, component] of combo.componentes.entries()) {
      const totalQuantity = component.quantidade * line.quantidade;
      let movementId: number | null = null;
      let debitadoEm: Date | null = null;
      if (component.tipo === "PRODUTO" && component.Produto?.controlaEstoque) {
        const movement = await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            contaId: args.contaId,
            ordemId: args.ordemServicoId,
            produtoId: component.Produto.id,
            quantidade: totalQuantity,
            custo: allocated[index],
            status: "CONCLUIDO",
            tipo: "SAIDA",
            clienteFornecedor: args.clienteId || null,
          },
        });
        movementId = movement.id;
        debitadoEm = new Date();
      }
      await tx.comboSaidaComponente.create({
        data: {
          contaId: args.contaId,
          comboSaidaId: output.id,
          tipo: component.tipo,
          produtoId: component.produtoId,
          servicoId: component.servicoId,
          nomeSnapshot: component.Produto
            ? `${component.Produto.nome}${component.Produto.nomeVariante ? ` / ${component.Produto.nomeVariante}` : ""}`
            : component.Servico!.nome,
          quantidadePorCombo: component.quantidade,
          quantidadeTotal: totalQuantity,
          valorUnitarioRateado: allocated[index],
          movimentacaoId: movementId,
          debitadoEm,
        },
      });
    }
    outputs.push(output);
  }
  return outputs;
}

export async function restoreComboOrdemStock(tx: Transaction, contaId: number, ordemServicoId: number) {
  const components = await tx.comboSaidaComponente.findMany({
    where: { contaId, ComboSaida: { ordemServicoId }, produtoId: { not: null }, debitadoEm: { not: null }, devolvidoEm: null },
    orderBy: { produtoId: "asc" },
  });
  for (const item of components) {
    await tx.produto.update({ where: { id: item.produtoId! }, data: { estoque: { increment: item.quantidadeTotal } } });
    await tx.comboSaidaComponente.update({ where: { id: item.id }, data: { devolvidoEm: new Date() } });
  }
}

export async function createComboComandaSaida(
  tx: Transaction,
  args: {
    contaId: number;
    comboId: number;
    quantidade: number;
    comandaVendaId?: number;
    comandaItemId?: number;
    comandaOperacaoId?: number;
    comandaOperacaoItemId?: number;
  },
) {
  const combo = await tx.combo.findFirst({
    where: { id: args.comboId, contaId: args.contaId, ativo: true },
    include: comboInclude,
  });
  if (!combo) throw new ComboError("combo_not_found", "Combo indisponível.", 404);
  if (!Number.isInteger(args.quantidade) || args.quantidade <= 0) {
    throw new ComboError("combo_validation_failed", "Quantidade do combo deve ser inteira e positiva.", 422);
  }

  const totals = new Map<number, number>();
  for (const component of combo.componentes) {
    if (component.tipo === "SERVICO" && !component.Servico?.status) {
      throw new ComboError("combo_service_inactive", `O serviço ${component.Servico?.nome || ""} está inativo.`);
    }
    if (component.tipo === "PRODUTO") {
      const product = component.Produto;
      if (!product || product.status !== "ATIVO" || product.saidas === false) {
        throw new ComboError("combo_product_blocked", `O produto ${product?.nome || ""} não permite saída.`);
      }
      if (product.controlaEstoque) {
        totals.set(product.id, (totals.get(product.id) || 0) + component.quantidade * args.quantidade);
      }
    }
  }
  for (const [productId, quantity] of [...totals].sort(([a], [b]) => a - b)) {
    await assertAvailableAndDecrement(tx, args.contaId, productId, quantity);
  }

  const output = await tx.comboSaida.create({
    data: {
      contaId: args.contaId,
      comboId: combo.id,
      comandaVendaId: args.comandaVendaId,
      comandaItemId: args.comandaItemId,
      comandaOperacaoId: args.comandaOperacaoId,
      comandaOperacaoItemId: args.comandaOperacaoItemId,
      canal: "COMANDA",
      nomeSnapshot: combo.nome,
      descricaoSnapshot: combo.descricao,
      imagemSnapshot: combo.imagem,
      precoUnitarioSnapshot: combo.preco,
      quantidade: args.quantidade,
      subtotal: new Decimal(combo.preco).mul(args.quantidade),
    },
  });
  const allocated = allocateValues(combo);
  for (const [index, component] of combo.componentes.entries()) {
    const controlledProduct = component.tipo === "PRODUTO" && component.Produto?.controlaEstoque;
    await tx.comboSaidaComponente.create({
      data: {
        contaId: args.contaId,
        comboSaidaId: output.id,
        tipo: component.tipo,
        produtoId: component.produtoId,
        servicoId: component.servicoId,
        nomeSnapshot: component.Produto
          ? `${component.Produto.nome}${component.Produto.nomeVariante ? ` / ${component.Produto.nomeVariante}` : ""}`
          : component.Servico!.nome,
        quantidadePorCombo: component.quantidade,
        quantidadeTotal: component.quantidade * args.quantidade,
        valorUnitarioRateado: allocated[index],
        debitadoEm: controlledProduct ? new Date() : null,
      },
    });
  }
  return output;
}

export async function restoreComboComandaItemStock(
  tx: Transaction,
  contaId: number,
  link: { comandaItemId?: number; comandaOperacaoItemId?: number },
) {
  const components = await tx.comboSaidaComponente.findMany({
    where: {
      contaId,
      ComboSaida: link,
      produtoId: { not: null },
      debitadoEm: { not: null },
      devolvidoEm: null,
    },
    orderBy: { produtoId: "asc" },
  });
  for (const component of components) {
    if (component.movimentacaoId) {
      await tx.movimentacoesEstoque.deleteMany({
        where: { id: component.movimentacaoId, contaId },
      });
    }
    await tx.produto.update({
      where: { id: component.produtoId!, contaId },
      data: { estoque: { increment: component.quantidadeTotal } },
    });
    await tx.comboSaidaComponente.update({
      where: { id: component.id },
      data: { devolvidoEm: new Date() },
    });
  }
}

export async function attachComboComandaItemsToVenda(
  tx: Transaction,
  args: { contaId: number; comandaItemIds: number[]; vendaId: number; clienteId?: number | null },
) {
  const outputs = await tx.comboSaida.findMany({
    where: { contaId: args.contaId, comandaItemId: { in: args.comandaItemIds } },
    include: { componentes: true },
  });
  for (const output of outputs) {
    await tx.comboSaida.update({ where: { id: output.id }, data: { vendaId: args.vendaId } });
    for (const component of output.componentes) {
      if (!component.produtoId || !component.debitadoEm || component.movimentacaoId) continue;
      const movement = await tx.movimentacoesEstoque.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          contaId: args.contaId,
          vendaId: args.vendaId,
          produtoId: component.produtoId,
          quantidade: component.quantidadeTotal,
          custo: component.valorUnitarioRateado,
          status: "CONCLUIDO",
          tipo: "SAIDA",
          clienteFornecedor: args.clienteId || null,
        },
      });
      await tx.comboSaidaComponente.update({
        where: { id: component.id },
        data: { movimentacaoId: movement.id },
      });
    }
  }
}

export async function reserveComboOrderSaidas(
  tx: Transaction,
  args: { contaId: number; pedidoId: number; expiresAt: Date; lines: ComboLine[] },
) {
  if (!args.lines.length) return [];
  const ids = [...new Set(args.lines.map((item) => item.id))];
  const combos = await tx.combo.findMany({
    where: { contaId: args.contaId, id: { in: ids }, ativo: true, mostrarOnline: true },
    include: comboInclude,
  });
  if (combos.length !== ids.length) throw new ComboError("combo_not_found", "Um ou mais combos não estão disponíveis.", 404);
  const map = new Map(combos.map((combo) => [combo.id, combo]));
  const productIds = combos.flatMap((combo) => combo.componentes.flatMap((item) => item.produtoId ? [item.produtoId] : []));
  if (productIds.length) {
    const unique = [...new Set(productIds)].sort((a, b) => a - b);
    const placeholders = unique.map(() => "?").join(",");
    await tx.$queryRawUnsafe(
      `SELECT id FROM Produto WHERE contaId = ? AND id IN (${placeholders}) ORDER BY id FOR UPDATE`,
      args.contaId,
      ...unique,
    );
  }
  const outputs = [];
  for (const [order, line] of args.lines.entries()) {
    const combo = map.get(line.id)!;
    const allocated = allocateValues(combo);
    const output = await tx.comboSaida.create({
      data: {
        contaId: args.contaId,
        comboId: combo.id,
        lojaPedidoId: args.pedidoId,
        canal: "LOJA",
        nomeSnapshot: combo.nome,
        descricaoSnapshot: combo.descricao,
        imagemSnapshot: combo.imagem,
        precoUnitarioSnapshot: combo.preco,
        quantidade: line.quantidade,
        subtotal: new Decimal(combo.preco).mul(line.quantidade),
        ordem: order,
      },
    });
    for (const [index, component] of combo.componentes.entries()) {
      const totalQuantity = component.quantidade * line.quantidade;
      if (component.tipo === "SERVICO" && !component.Servico?.status) throw new ComboError("combo_service_inactive", `O serviço ${component.Servico?.nome} está inativo.`);
      if (component.tipo === "PRODUTO" && (!component.Produto || component.Produto.saidas === false || component.Produto.status !== "ATIVO")) {
        throw new ComboError("combo_product_blocked", `O produto ${component.Produto?.nome || ""} não permite saída.`);
      }
      const snapshot = await tx.comboSaidaComponente.create({
        data: {
          contaId: args.contaId,
          comboSaidaId: output.id,
          tipo: component.tipo,
          produtoId: component.produtoId,
          servicoId: component.servicoId,
          nomeSnapshot: component.Produto
            ? `${component.Produto.nome}${component.Produto.nomeVariante ? ` / ${component.Produto.nomeVariante}` : ""}`
            : component.Servico!.nome,
          quantidadePorCombo: component.quantidade,
          quantidadeTotal: totalQuantity,
          valorUnitarioRateado: allocated[index],
        },
      });
      if (component.tipo === "PRODUTO" && component.Produto?.controlaEstoque) {
        const reserved = await getReservedQuantity(tx, args.contaId, component.Produto.id);
        const available = Math.max(0, component.Produto.estoque - reserved);
        if (available < totalQuantity) {
          throw new ComboError("stock_unavailable", `${component.Produto.nome} não possui estoque suficiente.`, 409, {
            produtoId: component.Produto.id,
            requested: totalQuantity,
            available,
          });
        }
        await tx.comboReservaEstoque.create({
          data: {
            contaId: args.contaId,
            pedidoId: args.pedidoId,
            comboSaidaComponenteId: snapshot.id,
            produtoId: component.Produto.id,
            quantidade: totalQuantity,
            expiresAt: args.expiresAt,
          },
        });
      }
    }
    outputs.push(output);
  }
  return outputs;
}

export async function confirmComboOrderReservations(tx: Transaction, contaId: number, pedidoId: number) {
  await tx.comboReservaEstoque.updateMany({
    where: { contaId, pedidoId, status: "ATIVA" },
    data: { status: "CONFIRMADA", expiresAt: null },
  });
}

export async function releaseComboOrderReservations(
  tx: Transaction,
  contaId: number,
  pedidoId: number,
  status: "LIBERADA" | "EXPIRADA" = "LIBERADA",
) {
  await tx.comboReservaEstoque.updateMany({
    where: { contaId, pedidoId, status: { in: ["ATIVA", "CONFIRMADA"] } },
    data: { status, releasedAt: new Date(), expiresAt: null },
  });
}

export async function consumeComboOrderReservations(tx: Transaction, contaId: number, pedidoId: number, vendaId: number) {
  const reservations = await tx.comboReservaEstoque.findMany({
    where: { contaId, pedidoId, status: { in: ["ATIVA", "CONFIRMADA"] } },
    include: { ComboSaidaComponente: true },
    orderBy: { produtoId: "asc" },
  });
  for (const reservation of reservations) {
    const product = await tx.produto.findFirstOrThrow({ where: { id: reservation.produtoId, contaId } });
    if (product.estoque < reservation.quantidade) throw new ComboError("stock_unavailable", `Estoque físico inconsistente para ${product.nome}.`, 409);
    await tx.produto.update({ where: { id: product.id }, data: { estoque: { decrement: reservation.quantidade } } });
    const movement = await tx.movimentacoesEstoque.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("MOV"),
        contaId,
        vendaId,
        produtoId: product.id,
        quantidade: reservation.quantidade,
        custo: reservation.ComboSaidaComponente.valorUnitarioRateado,
        status: "CONCLUIDO",
        tipo: "SAIDA",
      },
    });
    await tx.comboReservaEstoque.update({
      where: { id: reservation.id },
      data: { status: "CONSUMIDA", consumedAt: new Date(), expiresAt: null, movimentacaoId: movement.id },
    });
    await tx.comboSaidaComponente.update({
      where: { id: reservation.comboSaidaComponenteId },
      data: { movimentacaoId: movement.id, debitadoEm: new Date() },
    });
  }
  await tx.comboSaida.updateMany({ where: { contaId, lojaPedidoId: pedidoId }, data: { vendaId } });
  const outputs = await tx.comboSaida.findMany({ where: { contaId, lojaPedidoId: pedidoId } });
  if (outputs.length) {
    await tx.itensVendas.createMany({
      data: outputs.map((item) => ({
        vendaId,
        itemName: item.nomeSnapshot,
        produtoId: null,
        servicoId: null,
        quantidade: item.quantidade,
        valor: item.precoUnitarioSnapshot,
      })),
    });
  }
}
