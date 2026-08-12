import assert from "node:assert/strict";
import test from "node:test";
import { buildDpsDraft, nationalEndpoints } from "./nacionalProvider";

test("monta DPS nacional com identificador sequencial e código IBGE", () => {
  const dps = buildDpsDraft({
    codigoMunicipioIbge: "2111508", documentoPrestador: "06.019.491/0001-07", inscricaoMunicipal: "123", serie: 1, numero: 9,
    codigoServico: "1.01", discriminacao: "Serviço de teste", valorTotal: 10,
  });
  assert.equal(dps.versaoLeiaute, "DPS_NACIONAL");
  assert.match(dps.id, /^21115082\d{14}00001000000000000009$/);
  assert.equal(dps.municipioEmissorIbge, "2111508");
  assert.equal(dps.servico.valor, 10);
});

test("usa os endpoints oficiais distintos para homologação e produção", () => {
  assert.match(nationalEndpoints("HOMOLOGACAO").sefin, /producaorestrita/);
  assert.match(nationalEndpoints("PRODUCAO").sefin, /sefin\.nfse\.gov\.br/);
});
