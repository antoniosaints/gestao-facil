import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { PrismaClient } from "../../../generated";
import { atualizarCalculosContaFinanceira } from "../../controllers/financeiro/contaCalculos";
import type { CustomData } from "../../helpers/getCustomRequest";

const sessao: CustomData = {
  userId: 2, email: "teste@example.invalid", permissao: "usuario",
  contaId: 9, contaStatus: "ATIVO",
};
const suporte = { ...sessao, impersonacao: { sessaoId: 11, superAdminId: 12 } };

function montar() {
  const gravacoes: unknown[] = [];
  const notificacoes: unknown[] = [];
  const db = {
    contasFinanceiro: {
      updateMany: async (args: { where: { id: number; contaId: number } }) => {
        gravacoes.push(args);
        return { count: args.where.id === 7 && args.where.contaId === 9 ? 1 : 0 };
      },
    },
  } as unknown as Pick<PrismaClient, "contasFinanceiro">;
  const handler = atualizarCalculosContaFinanceira(
    db,
    async (session, level) => session.permissao === "gerente" && level === 3,
    (contaId, id) => notificacoes.push({ contaId, id }),
  );

  async function enviar(session: CustomData | undefined, id: string, body: unknown) {
    let status = 0;
    let payload: any;
    const req = { customData: session, params: { id }, body } as unknown as Request;
    const res = {
      status(value: number) { status = value; return this; },
      json(value: unknown) { payload = value; },
    } as unknown as Response;
    await handler(req, res, (error?: unknown) => { throw error; });
    return { status, payload };
  }

  return { enviar, gravacoes, notificacoes };
}

test("permite alternar a preferência na sessão de suporte validada, no escopo do assinante", async () => {
  const h = montar();
  for (const ignorarNosCalculos of [true, false]) {
    const { status, payload } = await h.enviar(suporte, "7", { ignorarNosCalculos });
    assert.equal(status, 200);
    assert.deepEqual(payload.data, { id: 7, ignorarNosCalculos });
  }
  assert.deepEqual(h.gravacoes, [
    { where: { id: 7, contaId: 9 }, data: { ignorarNosCalculos: true } },
    { where: { id: 7, contaId: 9 }, data: { ignorarNosCalculos: false } },
  ]);
  assert.deepEqual(h.notificacoes, [{ contaId: 9, id: 7 }, { contaId: 9, id: 7 }]);
});

test("exige autorização e aceita somente a preferência booleana", async () => {
  const h = montar();
  assert.equal((await h.enviar(undefined, "7", { ignorarNosCalculos: true })).status, 401);
  assert.equal((await h.enviar(sessao, "7", { ignorarNosCalculos: true, impersonacao: suporte.impersonacao })).status, 403);
  assert.equal((await h.enviar(suporte, "7", { ignorarNosCalculos: true, saldoInicial: 40 })).status, 400);
  assert.equal((await h.enviar(suporte, "7", { ignorarNosCalculos: "true" })).status, 400);
  assert.equal((await h.enviar(suporte, "-7", { ignorarNosCalculos: false })).status, 400);
  assert.equal(h.gravacoes.length, 0);

  assert.equal((await h.enviar(suporte, "8", { ignorarNosCalculos: false })).status, 404);
  assert.equal(h.notificacoes.length, 0);
  assert.equal((await h.enviar({ ...sessao, permissao: "gerente" }, "7", { ignorarNosCalculos: false })).status, 200);
});
