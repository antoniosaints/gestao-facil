import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readWApiInstance } from "./wApiInstanceSync";

describe("sincronização da conexão W-API", () => {
  it("prioriza o status real e limpa o número quando a instância está desconectada", async () => {
    const result = await readWApiInstance({
      status: async () => ({ connected: false }),
      fetchInstance: async () => ({ connected: true, connectedPhone: "5511999999999", paymentStatus: "PENDING", expires: 1787951232384 }),
    });
    assert.equal(result.status, "DESCONECTADA");
    assert.equal(result.connectedPhone, null);
    assert.equal(result.assinaturaStatus, "PENDING");
    assert.equal(result.expiresAt?.getTime(), 1787951232384);
    assert.equal(result.ultimoErro, null);
  });

  it("sincroniza a conexão mesmo se fetch-instance falhar", async () => {
    const result = await readWApiInstance({
      status: async () => ({ connected: false }),
      fetchInstance: async () => { throw new Error("Dados da instância indisponíveis"); },
    });
    assert.equal(result.status, "DESCONECTADA");
    assert.equal(result.connectedPhone, null);
    assert.equal(result.expiresAt, null);
    assert.match(result.ultimoErro!, /indisponíveis/);
  });

  it("usa a conexão de fetch-instance quando status-instance falhar", async () => {
    const result = await readWApiInstance({
      status: async () => { throw new Error("Consulta de status indisponível"); },
      fetchInstance: async () => ({ connected: true, connectedPhone: "5511999999999" }),
    });
    assert.equal(result.status, "CONECTADA");
    assert.equal(result.connectedPhone, "5511999999999");
    assert.match(result.ultimoErro!, /status indisponível/);
  });

  it("não inventa um status nem apaga o número quando as duas consultas falham", async () => {
    const fail = async () => { throw new Error("Tempo limite da W-API"); };
    const result = await readWApiInstance({ status: fail, fetchInstance: fail });
    assert.equal(result.status, null);
    assert.equal(result.connectedPhone, undefined);
    assert.match(result.ultimoErro!, /último status foi preservado/);
  });

  it("não usa pagamento ou recado do perfil como estado de conexão", async () => {
    const result = await readWApiInstance({
      status: async () => ({ status: "Ocupado" }),
      fetchInstance: async () => ({ paymentStatus: "PAID" }),
    });
    assert.equal(result.status, null);
    assert.equal(result.connectedPhone, undefined);
    assert.equal(result.assinaturaStatus, "PAID");
    assert.match(result.ultimoErro!, /estado de conexão válido/);
  });
});
