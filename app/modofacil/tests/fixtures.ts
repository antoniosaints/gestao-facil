import type { PrismaClient } from "../../../generated";

// Transactional test double, not an integration DB. Field projections are
// intentionally not modeled: assertions inspect the writes and persisted state.
export function database() {
  let state: any = { bases: [], variants: [], categories: [], people: [], operations: [], movements: [], reserved: 0 };
  const writes: any[] = [];
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
  const change = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value && typeof value === "object" && "increment" in value ? row[key] + (value as any).increment
        : value && typeof value === "object" && "decrement" in value ? row[key] - (value as any).decrement : value;
    }
  };
  const model = (name: string) => ({
    findFirst: async ({ where }: any) => state[name].find((r: any) => matches(r, where)) ?? null,
    findFirstOrThrow: async ({ where }: any) => {
      const row = state[name].find((r: any) => matches(r, where));
      if (!row) throw new Error("not found");
      return name === "bases" ? { ...row, variantes: state.variants.filter((v: any) => v.produtoBaseId === row.id) } : row;
    },
    findUniqueOrThrow: async (input: any) => tx.produtoBase.findFirstOrThrow(input),
    create: async ({ data }: any) => {
      const row = { id: state[name].length + (name === "bases" ? 101 : 201), ...data };
      state[name].push(row); writes.push({ name, action: "create", data: { ...data } }); return row;
    },
    updateMany: async ({ where, data }: any) => {
      const rows = state[name].filter((r: any) => matches(r, where));
      rows.forEach((r: any) => change(r, data)); writes.push({ name, action: "update", data: { ...data }, where });
      return { count: rows.length };
    },
    update: async ({ where, data }: any) => {
      const row = state[name].find((r: any) => matches(r, where)); if (!row) throw new Error("not found");
      change(row, data); writes.push({ name, action: "update", data: { ...data }, where }); return row;
    },
  });
  const tx: any = {
    produto: model("variants"), produtoBase: model("bases"), produtoCategoria: model("categories"), clientesFornecedores: model("people"), movimentacoesEstoque: model("movements"),
    $queryRaw: async (...args: any[]) => { writes.push({ lock: args }); return []; },
    $queryRawUnsafe: async (...args: any[]) => { writes.push({ lock: args }); return []; },
    lojaReservaEstoque: { aggregate: async () => ({ _sum: { quantidade: state.reserved } }) },
    comboReservaEstoque: { aggregate: async () => ({ _sum: { quantidade: 0 } }) },
    modoFacilOperacao: {
      findUnique: async ({ where }: any) => state.operations.find((r: any) => matches(r, where.contaId_chave)) ?? null,
      create: async ({ data }: any) => {
        if (state.operations.some((r: any) => r.contaId === data.contaId && r.chave === data.chave)) throw { code: "P2002" };
        state.operations.push({ ...data }); return data;
      },
      update: async ({ where, data }: any) => {
        const row = state.operations.find((r: any) => matches(r, where.contaId_chave)); Object.assign(row, data); return row;
      },
    },
  };
  let tail = Promise.resolve();
  const db = { ...tx, $transaction: (work: any) => {
    const run = tail.then(async () => {
      const before = structuredClone(state);
      try { return await work(tx); } catch (e) { state = before; throw e; }
    });
    tail = run.then(() => undefined, () => undefined); return run;
  } } as unknown as PrismaClient;
  return { db, writes, state: () => state };
}
