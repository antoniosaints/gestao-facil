import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteFiscalDocument,
  claimFiscalEmission,
  deleteFiscalDraft,
} from "./fiscalDeletionPolicy";
const draft = () =>
  ({
    id: 42,
    contaId: 7,
    vendaId: 18,
    tipo: "NFE",
    status: "PENDENTE",
    atualizadaEm: new Date("2026-09-30"),
    Eventos: [],
  }) as any;
test("permite registros não enviados de cada tipo, mas nunca os estados externos ou incertos", () => {
  for (const tipo of ["NFE", "NFCE", "NFSE"])
    for (const status of ["PENDENTE", "PRONTA_PARA_EMISSAO"])
      assert.equal(canDeleteFiscalDocument({ ...draft(), tipo, status }), true);
  for (const status of [
    "AUTORIZADA",
    "HOMOLOGADA",
    "CANCELADA",
    "EMITINDO",
    "EM_PROCESSAMENTO",
    "RESULTADO_INCERTO",
    "EMISSAO_INCERTA",
    "FALHA_REPROCESSAVEL",
    "EXCLUIDA",
  ])
    assert.equal(
      canDeleteFiscalDocument({ ...draft(), status }),
      false,
      status,
    );
});
test("não basta um status pendente se já houver evidência de envio/autorização", () => {
  for (const key of [
    "idIntegracao",
    "provedorId",
    "emitidaEm",
    "canceladaEm",
    "chaveAcesso",
    "protocolo",
    "codigoVerificacao",
    "xmlPath",
    "pdfPath",
    "respostaJson",
  ])
    assert.equal(
      canDeleteFiscalDocument({
        ...draft(),
        [key]: key === "respostaJson" ? {} : "valor",
      }),
      false,
      key,
    );
  assert.equal(
    canDeleteFiscalDocument({
      ...draft(),
      Eventos: [{ status: "PROCESSANDO" }],
    }),
    false,
  );
});
test("exige rejeição confirmada e bloqueia duplicidade, denegação e comunicação incerta", () => {
  const rejected = { ...draft(), status: "REJEITADA", provedor: "GERANET_NFE" };
  assert.equal(canDeleteFiscalDocument(rejected), false);
  assert.equal(
    canDeleteFiscalDocument({
      ...rejected,
      respostaJson: {
        situacao: "erro",
        cstat: "225",
        mensagem: "Falha no schema XML",
      },
    }),
    true,
  );
  for (const cstat of [
    "100",
    "150",
    "110",
    "204",
    "301",
    "302",
    "303",
    "539",
    "999",
  ])
    assert.equal(
      canDeleteFiscalDocument({
        ...rejected,
        respostaJson: { situacao: "erro", cstat },
      }),
      false,
      cstat,
    );
  assert.equal(
    canDeleteFiscalDocument({
      ...rejected,
      tipo: "NFSE",
      provedor: "GERANET_NFSE",
      respostaJson: { situacao: "erro", mensagem: "CPF inválido" },
    }),
    true,
  );
  assert.equal(
    canDeleteFiscalDocument({
      ...rejected,
      tipo: "NFSE",
      provedor: "GERANET_NFSE",
      respostaJson: {
        situacao: "erro",
        mensagem: "Erro ao comunicar com o município",
      },
    }),
    false,
  );
  assert.equal(
    canDeleteFiscalDocument({
      ...rejected,
      tipo: "NFSE",
      provedor: "GERANET_NFSE",
      respostaJson: {
        situacao: "erro",
        mensagem: "RPS já convertido em NFS-e",
      },
    }),
    false,
  );
  assert.equal(
    canDeleteFiscalDocument({
      ...rejected,
      provedor: "TECNOSPEED_PLUGNOTAS",
      respostaJson: [{ status: "REJEITADO" }],
    }),
    true,
  );
});
function mockTx(record: any) {
  const calls: any[] = [];
  const tx: any = {
    notaFiscal: {
      findFirst: async (args: any) => {
        calls.push(["find", args]);
        return record?.contaId === args.where.contaId ? { ...record } : null;
      },
      updateMany: async (args: any) => {
        calls.push(["update", args]);
        if (
          !record ||
          (args.where.status.in
            ? !args.where.status.in.includes(record.status)
            : record.status !== args.where.status)
        )
          return { count: 0 };
        Object.assign(record, args.data);
        return { count: 1 };
      },
    },
    notaFiscalEvento: {
      create: async (args: any) => {
        calls.push(["audit", args]);
        return {};
      },
    },
  };
  return { tx, calls };
}
test("exclui e desvincula na mesma transação preservando o registro e a numeração", async () => {
  const record = { ...draft(), numero: "123", serie: 1 };
  const { tx, calls } = mockTx(record);
  assert.deepEqual(await deleteFiscalDraft(tx, 7, 42, 9), {
    id: 42,
    vendaId: 18,
    excluida: true,
  });
  assert.equal(record.status, "EXCLUIDA");
  assert.equal(record.vendaId, null);
  assert.equal(record.numero, "123");
  assert.deepEqual(calls[2][1].data.requisicaoJson, {
    userId: 9,
    vendaId: 18,
    statusAnterior: "PENDENTE",
  });
  assert.equal(calls[1][1].where.contaId, 7);
  assert.equal(calls[1][1].where.atualizadaEm, record.atualizadaEm);
  assert.equal(await claimFiscalEmission(tx, 42), false);
});
test("não permite excluir notas de outra conta nem autorizadas", async () => {
  await assert.rejects(
    deleteFiscalDraft(mockTx(draft()).tx, 8, 42, 9),
    (error: any) => error.status === 404,
  );
  const { tx, calls } = mockTx({ ...draft(), status: "AUTORIZADA" });
  await assert.rejects(
    deleteFiscalDraft(tx, 7, 42, 9),
    (error: any) => error.status === 409,
  );
  assert.equal(calls.length, 1);
});
test("worker que começa antes da exclusão vence a disputa e impede remoção", async () => {
  const record = draft();
  const { tx, calls } = mockTx(record);
  const find = tx.notaFiscal.findFirst;
  tx.notaFiscal.findFirst = async (args: any) => {
    const snapshot = await find(args);
    await claimFiscalEmission(tx, 42);
    return snapshot;
  };
  await assert.rejects(
    deleteFiscalDraft(tx, 7, 42, 9),
    (error: any) => error.code === "fiscal_delete_conflict",
  );
  assert.equal(record.status, "EMITINDO");
  assert.equal(record.vendaId, 18);
  assert.equal(
    calls.some((call) => call[0] === "audit"),
    false,
  );
});
test("dois workers não enviam a mesma nota simultaneamente", async () => {
  const { tx } = mockTx(draft());
  const claimed = await Promise.all([
    claimFiscalEmission(tx, 42),
    claimFiscalEmission(tx, 42),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
});
