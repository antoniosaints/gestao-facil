import assert from "node:assert/strict";
import test from "node:test";
import { buildD2tiSoapEnvelope, parseD2tiResponse } from "./d2tiSaoMateus";

const input = {
  ambiente: "HOMOLOGACAO" as const,
  token: "C36D17ABC320D2054E91AD97A46B6BBB",
  prestador: { documento: "06019491000107", inscricaoMunicipal: "123", razaoSocial: "Empresa Teste", logradouro: "Rua do Sol", bairro: "Centro", cep: "65470000", codigoMunicipio: "923", descricaoMunicipio: "SAO MATEUS DO MARANHAO", uf: "MA", descricaoUf: "MARANHAO" },
  tomador: { documento: "12345678901", razaoSocial: "Cliente Teste", logradouro: "Rua A", bairro: "Centro", cep: "65470000", codigoMunicipio: "923", descricaoMunicipio: "SAO MATEUS DO MARANHAO", uf: "MA", descricaoUf: "MARANHAO" },
  codigoServico: "1005", descricaoServico: "Servico de teste", codigoAtividade: "5611203", descricaoAtividade: "Restaurante", tipoTributacao: 1, tipoRecolhimento: 1, notaIntermediada: 2, aliquotaIss: 5, discriminacao: "Servico de teste & complemento", valorTotal: 10,
};

test("monta envelope D2TI com cabeçalho e nota XML escapados", () => {
  const xml = buildD2tiSoapEnvelope(input);
  assert.match(xml, /<wsn:executar>/);
  assert.match(xml, /&lt;ambiente&gt;2&lt;\/ambiente&gt;/);
  assert.match(xml, /Servico de teste &amp;amp; complemento/);
  assert.match(xml, /&lt;codigoMunicipio&gt;923&lt;\/codigoMunicipio&gt;/);
});

test("interpreta autorização e rejeição do retorno D2TI", () => {
  const ok = parseD2tiResponse("<return>&lt;retornoNfseLote&gt;&lt;codigoStatus&gt;100&lt;/codigoStatus&gt;&lt;protocolo&gt;123&lt;/protocolo&gt;&lt;numeroNota&gt;456&lt;/numeroNota&gt;&lt;linkPdfNota&gt;stm.exemplo/nota.pdf&lt;/linkPdfNota&gt;&lt;chaveSeguranca&gt;ABC&lt;/chaveSeguranca&gt;&lt;/retornoNfseLote&gt;</return>");
  assert.equal(ok.status, "AUTORIZADA");
  assert.equal(ok.numero, "456");
  assert.equal(ok.pdfUrl, "http://stm.exemplo/nota.pdf");
  const rejected = parseD2tiResponse("<retornoNfseLote><codigoStatus>101</codigoStatus><erros><erro><descricao>Token inválido</descricao></erro></erros></retornoNfseLote>");
  assert.equal(rejected.status, "REJEITADA");
  assert.equal(rejected.mensagem, "Token inválido");
});
