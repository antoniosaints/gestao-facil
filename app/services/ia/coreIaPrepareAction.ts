import Decimal from "decimal.js";
import type { CustomData } from "../../helpers/getCustomRequest";
import type { PreparedAction } from "./coreIaActions";
import { validateWrite, type WriteToolName } from "./coreIaToolPolicy";

const brl = (value: number | string) =>
  new Decimal(value)
    .toNumber()
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const todayInBrazil = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const titles: Record<WriteToolName, string> = {
  createClienteNovo: "Cadastrar cliente",
  createServicoNovo: "Cadastrar serviço",
  createProdutoNovo: "Cadastrar produto",
  createLancamentoFinanceiro: "Registrar lançamento",
  createVendaNova: "Registrar venda",
  createReposicaoEstoqueProduto: "Repor estoque",
};

// Exact lookup first prevents an arbitrary search page from hiding duplicate names.
async function findNamedRecords(
  table: any,
  where: any,
  nome: string,
  select: any,
) {
  const exact = await table.findMany({
    where: { ...where, nome },
    select,
    take: 2,
  });
  if (exact.length) return exact;
  return table.findMany({
    where: { ...where, nome: { contains: nome } },
    select,
    take: 8,
  });
}

// Injected database enables contract tests without customer data or network access.
export async function prepareCoreIaAction(
  name: WriteToolName,
  raw: unknown,
  request: CustomData,
  db: any,
  resolveAccount: (args: any, contaId: number) => Promise<any>,
): Promise<PreparedAction> {
  let args = validateWrite(name, raw);
  let fields: PreparedAction["fields"] = [];
  const field = (label: string, value: unknown) =>
    fields.push({ label, value: String(value) });
  const where = { contaId: request.contaId };
  if (name === "createClienteNovo") {
    field("Nome", args.nome);
    for (const [key, label] of [
      ["documento", "Documento"],
      ["telefone", "Telefone"],
      ["email", "Email"],
      ["endereco", "Endereço"],
    ])
      if (args[key]) field(label, args[key]);
    const duplicate = await db.clientesFornecedores.findFirst({
      where: {
        ...where,
        OR: [
          { nome: args.nome },
          ...(args.documento ? [{ documento: args.documento }] : []),
        ],
      },
      select: { id: true },
    });
    if (duplicate)
      throw new Error(
        "Já existe um cliente com esse nome ou documento. Consulte o cadastro existente.",
      );
  } else if (name === "createServicoNovo" || name === "createProdutoNovo") {
    field("Nome", args.nome || args.servico);
    field("Preço", brl(args.preco));
    if (name === "createProdutoNovo") {
      field("Estoque inicial", args.estoque);
      field("Estoque mínimo", args.minimo);
    }
  } else if (name === "createReposicaoEstoqueProduto") {
    const product = await db.produto.findFirst({
      where: { ...where, id: args.idProduto },
      select: { nome: true },
    });
    if (!product) throw new Error("Produto não encontrado nesta conta.");
    field("Produto", product.nome);
    field("Quantidade", args.quantidade);
    if (args.valor !== undefined) field("Custo unitário", brl(args.valor));
    if (args.nota) field("Nota", args.nota);
  } else if (name === "createLancamentoFinanceiro") {
    const account = await resolveAccount(args, request.contaId);
    if (!account.conta)
      throw new Error(
        `${account.mensagem} Opções: ${(account.opcoes || []).map((item: any) => item.nome).join(", ")}`,
      );
    args.contaFinanceiraId = account.conta.id;
    args.contaFinanceira = account.conta.nome;
    args.data ||= todayInBrazil();
    field("Descrição", args.descricao);
    field("Tipo", args.tipo);
    field("Valor", brl(args.valor));
    field("Conta", account.conta.nome);
    field("Categoria", args.categoria);
    field("Data", args.data.split("-").reverse().join("/"));
    field("Pagamento", args.formaPagamento);
    field("Situação", args.pago ? "Pago — efetiva o financeiro" : "Pendente");
  } else if (name === "createVendaNova") {
    let clienteId: number | undefined;
    if (args.cliente || args.clienteId) {
      const matches = args.clienteId
        ? await db.clientesFornecedores.findMany({
            where: { ...where, id: args.clienteId },
            select: { id: true, nome: true },
            take: 1,
          })
        : await findNamedRecords(db.clientesFornecedores, where, args.cliente, {
            id: true,
            nome: true,
          });
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? `Há mais de um cliente. Peça uma identificação adicional: ${matches.map((c: any) => c.nome).join(", ")}`
            : "Cliente não encontrado. Pergunte se deseja cadastrá-lo primeiro.",
        );
      clienteId = matches[0].id;
      field("Cliente", matches[0].nome);
    } else field("Cliente", "Consumidor não identificado");
    const itens = [];
    let total = new Decimal(0);
    for (const item of args.itens) {
      const table = item.tipo === "PRODUTO" ? db.produto : db.servicos;
      const select = {
        id: true,
        nome: true,
        preco: true,
        ...(item.tipo === "PRODUTO"
          ? { estoque: true, saidas: true, codigo: true }
          : {}),
      };
      const matches = item.id
        ? await table.findMany({
            where: { ...where, id: item.id },
            select,
            take: 1,
          })
        : await findNamedRecords(table, where, item.nome, select);
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? `Qual item deseja usar para ${item.nome}? ${matches.map((c: any) => `${c.nome}${c.codigo ? ` (${c.codigo})` : ""}`).join(", ")}. Peça a escolha e resolva o ID pela consulta do catálogo.`
            : `Item não encontrado: ${item.nome}. Consulte o catálogo ou cadastre primeiro.`,
        );
      const record = matches[0];
      if (
        item.tipo === "PRODUTO" &&
        (record.saidas === false || Number(record.estoque) < item.quantidade)
      )
        throw new Error(
          `Saída indisponível ou estoque insuficiente para ${record.nome}.`,
        );
      const preco = item.preco ?? Number(record.preco);
      const subtotal = new Decimal(preco).mul(item.quantidade);
      total = total.add(subtotal);
      field(
        `${record.nome}${record.codigo ? ` (${record.codigo})` : ""}`,
        `${item.quantidade} × ${brl(preco)} = ${brl(subtotal.toString())}`,
      );
      itens.push({
        id: record.id,
        tipo: item.tipo,
        nome: record.nome,
        quantidade: item.quantidade,
        preco,
      });
    }
    if (total.gt(99999999.99))
      throw new Error("O total da venda excede o limite permitido.");
    if (total.lt(args.desconto))
      throw new Error("O desconto não pode superar o valor da venda.");
    field("Desconto", brl(args.desconto));
    field("Total", brl(total.sub(args.desconto).toString()));
    field(
      "Situação",
      "Finalizada; pagamento pendente. Baixa estoque; recebimento e faturamento são feitos na tela de vendas.",
    );
    field("Pagamento previsto", args.pagamento);
    const data = args.data || todayInBrazil();
    field("Data", data.split("-").reverse().join("/"));
    if (args.observacoes) field("Observações", args.observacoes);
    args = {
      itens,
      clienteId,
      data: `${data}T00:00:00-03:00`,
      desconto: args.desconto,
      observacoes: args.observacoes,
      pagamento: args.pagamento,
      status: "FINALIZADO",
      tipoDocumentoFiscal: "NENHUM",
    };
  }
  return { name, args, title: titles[name], fields };
}
