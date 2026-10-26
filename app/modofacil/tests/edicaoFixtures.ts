import { database } from "./fixtures";
import { atualizarVendaTx } from "../../services/vendas/vendaEdicaoService";
import { atualizarOrdemTx } from "../../services/servicos/ordemEdicaoService";

const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
const assign = (row: any, data: any) => { for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v; };

export function editingDatabase() {
  const d = database(); const state = d.state();
  state.variants.push({ id: 201, contaId: 1, nome: "Café", nomeVariante: "Padrão", estoque: 8, minimo: 1, preco: 10, saidas: true, controlaEstoque: true });
  state.sales = [{ id: 301, contaId: 1, data: new Date("2026-10-26T15:00:00Z"), createdAt: new Date("2026-10-20T00:00:00Z"), clienteId: null, vendedorId: null, garantia: null, observacoes: "Anterior", status: "PENDENTE", desconto: 0, valor: 20, faturado: false, comandaId: null, caixaId: 88 }];
  state.orders = [{ id: 401, contaId: 1, Uid: "OS_EXEMPLO", data: new Date("2026-10-26T15:00:00Z"), clienteId: 7, operadorId: 10, garantia: "90 dias de cobertura", descricao: "Descrição antiga", descricaoCliente: "Relato antigo", status: "ABERTA", desconto: 0 }];
  state.saleItems = [{ id: 501, vendaId: 301, produtoId: 201, servicoId: null, quantidade: 2, valor: 10, itemName: "Café" }];
  state.orderItems = [{ id: 601, ordemId: 401, produtoId: 201, servicoId: null, quantidade: 2, valor: 10, itemName: "Café", tipo: "PRODUTO" }];
  state.movements.push({ id: 701, contaId: 1, vendaId: 301, produtoId: 201, tipo: "SAIDA", quantidade: 2 });
  state.finance = []; state.charges = []; state.fiscal = []; state.people.push({ id: 7, contaId: 1 });
  const tx: any = d.db;
  const record = (name: string, items: string, relation: string) => ({
    findFirst: async ({ where }: any) => {
      const row = d.state()[name].find((r: any) => matches(r, where));
      return row ? { ...row, [relation]: d.state()[items].map((v: any) => ({ ...v })), ComboSaidas: [], LancamentoFinanceiro: d.state().finance, CobrancasFinanceiras: d.state().charges, NotaFiscals: d.state().fiscal } : null;
    },
    findUnique: async (input: any) => tx[name === "sales" ? "vendas" : "ordensServico"].findFirst(input),
    update: async ({ where, data }: any) => { const row = d.state()[name].find((r: any) => matches(r, where)); if (!row) throw new Error("not found"); assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { const rows = d.state()[name].filter((r: any) => matches(r, where)); rows.forEach((r: any) => assign(r, data)); return { count: rows.length }; },
  });
  tx.vendas = record("sales", "saleItems", "ItensVendas"); tx.ordensServico = record("orders", "orderItems", "ItensOrdensServico");
  const itemModel = (name: string) => ({
    deleteMany: async ({ where }: any) => { d.state()[name] = d.state()[name].filter((r: any) => !matches(r, where)); },
    createMany: async ({ data }: any) => { d.state()[name].push(...data.map((r: any, i: number) => ({ id: 801 + i, ...r }))); return { count: data.length }; },
  });
  tx.itensVendas = itemModel("saleItems"); tx.itensOrdensServico = itemModel("orderItems");
  tx.comboSaidaComponente = { findMany: async () => [] }; tx.comboSaida = { deleteMany: async () => ({ count: 0 }) }; tx.combo = { findMany: async () => [] };
  tx.usuarios = { findFirst: async ({ where }: any) => where.contaId === 1 ? { id: where.id } : null };
  tx.servicos = { findFirst: async () => null };
  tx.movimentacoesEstoque.deleteMany = async ({ where }: any) => {
    d.state().movements = d.state().movements.filter((r: any) => where.id ? true : !matches(r, where)); return { count: 0 };
  };
  // Extend the actual transaction double, retaining atomic rollback/serialization.
  const original = d.db.$transaction;
  tx.$transaction = (fn: any) => original.call(d.db, async (inner: any) => fn({ ...inner, vendas: tx.vendas, ordensServico: tx.ordensServico, itensVendas: tx.itensVendas, itensOrdensServico: tx.itensOrdensServico, comboSaidaComponente: tx.comboSaidaComponente, comboSaida: tx.comboSaida, combo: tx.combo, usuarios: tx.usuarios, servicos: tx.servicos }));
  const comboStock: any = { restoreComboVendaStock: async () => undefined, createComboVendaSaidas: async () => undefined, restoreComboOrdemStock: async () => undefined, createComboOrdemSaidas: async () => undefined };
  const ports = {
    venda: (transaction: any, id: number, data: any, session: any) => atualizarVendaTx(transaction, id, data, session, comboStock),
    os: (transaction: any, id: number, data: any, session: any) => atualizarOrdemTx(transaction, id, data, session, comboStock),
    hasCombos: async () => false,
  };
  return { ...d, ports };
}
