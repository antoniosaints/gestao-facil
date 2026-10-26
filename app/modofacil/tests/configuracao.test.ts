import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "../../../generated";
import { getConfiguracao, putConfiguracao } from "../configuracao/service";
import { requireAccess } from "../access";

function database() {
  const rows = new Map<number, any>();
  const db = { modoFacilConfiguracao: {
    findUnique: async ({ where }: any) => rows.get(where.contaId) ?? null,
    create: async ({ data }: any) => {
      if (rows.has(data.contaId)) throw { code: "P2002" };
      rows.set(data.contaId, { ...data }); return data;
    },
    updateMany: async ({ where, data }: any) => {
      const current = rows.get(where.contaId);
      if (!current || current.versao !== where.versao) return { count: 0 };
      rows.set(where.contaId, { ...current, ...data, versao: current.versao + 1 });
      return { count: 1 };
    },
  } } as unknown as PrismaClient;
  return { db, rows };
}
const admin = { contaId: 1, userId: 10, permissao: "admin" };

test("ausência mantém Normal/0, capacidade depende da permissão", async () => {
  const { db } = database();
  assert.deepEqual(await getConfiguracao(db, 1, "usuario"), { modo: "NORMAL", versao: 0, podeAlterar: false });
  assert.deepEqual(await getConfiguracao(db, 1, "root"), { modo: "NORMAL", versao: 0, podeAlterar: true });
});
test("admin altera somente sua conta, volta Normal e registra auditoria de suporte", async () => {
  const { db, rows } = database();
  assert.deepEqual(await putConfiguracao(db, admin, { modo: "FACIL", versao: 0 }), { modo: "FACIL", versao: 1, podeAlterar: true });
  assert.equal((await getConfiguracao(db, 2, "admin")).modo, "NORMAL");
  await putConfiguracao(db, { ...admin, impersonacao: { sessaoId: 22 } }, { modo: "NORMAL", versao: 1 });
  assert.equal(rows.get(1).alteradoPorId, 10);
  assert.equal(rows.get(1).suporteSessaoId, 22);
  assert.equal(rows.get(1).versao, 2);
});
test("usuário comum e gerente recebem 403 sem escrever", async () => {
  const { db, rows } = database();
  for (const permissao of ["usuario", "vendedor", "tecnico", "gerente", "invalida"]) {
    await assert.rejects(putConfiguracao(db, { ...admin, permissao }, { modo: "FACIL", versao: 0 }), { status: 403 });
  }
  assert.equal(rows.size, 0);
});
test("enum/versão/campos extras inválidos são rejeitados", async () => {
  const { db, rows } = database();
  for (const input of [{ modo: "facil", versao: 0 }, { modo: "FACIL", versao: -1 }, { modo: "FACIL", versao: 0.5 }, { modo: "FACIL", versao: 0, contaId: 2 }, { modo: "FACIL", versao: "0" }]) {
    await assert.rejects(putConfiguracao(db, admin, input));
  }
  assert.equal(rows.size, 0);
});
test("criação e atualização concorrentes têm exatamente um vencedor", async () => {
  const { db } = database();
  for (const versao of [0, 1]) {
    const result = await Promise.allSettled([putConfiguracao(db, admin, { modo: "FACIL", versao }), putConfiguracao(db, admin, { modo: "NORMAL", versao })]);
    assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
    const rejected = result.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
  }
});

test("middleware usa identidade atual da mesma conta, ignora privilégio antigo do token", async () => {
  let seen: any;
  const db = { usuarios: { findFirst: async (input: any) => { seen = input; return { status: "ATIVO", permissao: "gerente", Contas: { status: "ATIVO" } }; } } } as unknown as PrismaClient;
  const req = { customData: { ...admin, permissao: "root", impersonacao: { sessaoId: 1 } } };
  const error = await new Promise<any>(resolve => requireAccess(db, 4)(req as any, {} as any, resolve));
  assert.equal(error.status, 403);
  assert.deepEqual(seen.where, { id: 10, contaId: 1 });
});
test("usuário/conta inativos, vínculo ausente e sessão ausente não operam", async () => {
  for (const user of [null, { status: "INATIVO", permissao: "admin", Contas: { status: "ATIVO" } }, { status: "ATIVO", permissao: "admin", Contas: { status: "BLOQUEADO" } }]) {
    const db = { usuarios: { findFirst: async () => user } } as unknown as PrismaClient;
    const error = await new Promise<any>(resolve => requireAccess(db)({ customData: admin } as any, {} as any, resolve));
    assert.equal(error.status, 403);
  }
  const error = await new Promise<any>(resolve => requireAccess({} as any)({} as any, {} as any, resolve));
  assert.equal(error.status, 401);
});
