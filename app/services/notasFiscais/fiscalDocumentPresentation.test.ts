import test from "node:test";
import assert from "node:assert/strict";
import { fiscalDocumentPresentation } from "./fiscalDocumentPresentation";
test("exibe o snapshot fiscal sem devolver credenciais ou dados do envelope", () => {
  const invoice = {
    tipo: "NFE",
    valorTotal: 100,
    modelo: "55",
    provedor: "GERANET_NFE",
    emitenteSnapshotJson: {
      razaoSocial: "Emitente original",
      documento: "12345678000190",
      senhaCertificadoDigital: "SEGREDO",
      naturezaOperacao: "Venda",
      municipio: "Cidade",
      endereco: { logradouro: "Rua A", numero: "1", uf: "TO" },
      responsavelTecnico: { CSRT: "SEGREDO" },
    },
    destinatarioSnapshotJson: {
      nome: "Cliente original",
      documento: "12345678900",
      endereco: "Rua B",
      numero: "2",
    },
    Cliente: { nome: "Cadastro atualizado" },
    requisicaoJson: { token: "SEGREDO" },
  };
  const result = fiscalDocumentPresentation(invoice);
  assert.equal(result.emitente.nome, "Emitente original");
  assert.equal(result.destinatario.nome, "Cliente original");
  assert.equal(result.emitente.endereco, "Rua A, 1, Cidade - TO");
  assert.ok(!JSON.stringify(result).includes("SEGREDO"));
  assert.equal(result.totais.frete, null);
  assert.equal(result.tributos[0].valor, null);
});
test("totais e tributos vêm do grupo ICMSTot do XML, preservando zero e namespaces", () => {
  const result = fiscalDocumentPresentation(
    { tipo: "NFE", valorTotal: 90 },
    "<n:nfeProc><n:infNFe><n:ide><n:natOp>Venda &amp; entrega</n:natOp></n:ide><n:det><n:imposto><n:vBC>999</n:vBC></n:imposto></n:det><n:total><n:ICMSTot><n:vBC>100</n:vBC><n:vICMS>18</n:vICMS><n:vPIS>0</n:vPIS><n:vCOFINS>0</n:vCOFINS><n:vProd>100</n:vProd><n:vFrete>0</n:vFrete><n:vDesc>10</n:vDesc><n:vNF>90</n:vNF></n:ICMSTot></n:total></n:infNFe></n:nfeProc>",
  );
  assert.equal(result.naturezaOperacao, "Venda & entrega");
  assert.deepEqual(result.totais, {
    produtos: 100,
    frete: 0,
    desconto: 10,
    valorNota: 90,
  });
  assert.equal(result.tributos[0].valor, 100);
  assert.equal(result.tributos[2].valor, 0);
});
test("NFS-e usa dados do prestador e ISS, sem transformar IBS/CBS em base ISS", () => {
  const result = fiscalDocumentPresentation(
    {
      tipo: "NFSE",
      valorTotal: 200,
      emitenteSnapshotJson: {
        cnpj: "123",
        razaoSocial: "Prestador",
        inscricaoMunicipal: "456",
        endereco: "Rua C",
        nomeMunicipio: "Cidade",
        uf: "TO",
      },
    },
    "<Nfse><ValoresNfse><BaseCalculo>200</BaseCalculo><ValorIss>10</ValorIss><ValorIssRetido>0</ValorIssRetido><ValorServicos>200</ValorServicos></ValoresNfse></Nfse>",
  );
  assert.equal(result.emitente.inscricaoMunicipal, "456");
  assert.equal(result.totais.frete, null);
  assert.equal(result.tributos[1].valor, 10);
  assert.equal(
    fiscalDocumentPresentation(
      { tipo: "NFSE", valorTotal: 200 },
      "<IBSCBS><vBC>150</vBC></IBSCBS>",
    ).tributos[0].valor,
    null,
  );
});
test("arquivos ausentes ou números inválidos deixam valores indisponíveis sem estimar tributos", () => {
  const result = fiscalDocumentPresentation(
    { tipo: "NFE", valorTotal: 100 },
    "<ICMSTot><vICMS>erro</vICMS><vFrete></vFrete></ICMSTot>",
  );
  assert.equal(result.totais.valorNota, 100);
  assert.equal(result.totais.frete, null);
  assert.equal(result.tributos[1].valor, null);
});
