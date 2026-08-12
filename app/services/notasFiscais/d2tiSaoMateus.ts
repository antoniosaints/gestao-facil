import axios from "axios";

export const D2TI_SAO_MATEUS = {
  codigoIbge: "2111508",
  codigoTom: "923",
  provedor: "D2TI_CTA_SAO_MATEUS_MA",
  recepcaoUrl: "http://stm.saomateus.d2ti.com.br/wsnfselote/RecepcaoNFSePort",
} as const;

type Person = {
  documento: string;
  inscricaoMunicipal?: string | null;
  razaoSocial: string;
  logradouro: string;
  complemento?: string | null;
  bairro: string;
  cep: string;
  codigoMunicipio: string;
  descricaoMunicipio: string;
  uf: string;
  descricaoUf: string;
  email?: string | null;
  telefone?: string | null;
};

export type D2tiEmission = {
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  token: string;
  prestador: Person;
  tomador: Person;
  codigoServico: string;
  descricaoServico: string;
  codigoAtividade: string;
  descricaoAtividade: string;
  tipoTributacao: number;
  tipoRecolhimento: number;
  notaIntermediada: number;
  aliquotaIss: number;
  discriminacao: string;
  valorTotal: number;
};

export type D2tiResult = {
  status: "AUTORIZADA" | "REJEITADA" | "HOMOLOGADA";
  protocolo?: string;
  numero?: string;
  codigoVerificacao?: string;
  pdfUrl?: string;
  mensagem?: string;
  respostaXml: string;
};

function digits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function escapeXml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string) {
  const found = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return found ? decodeXml(found[1]).trim() : undefined;
}

function personXml(tagName: "prestador" | "tomador", person: Person, tomador = false) {
  const document = digits(person.documento);
  const documentTag = document.length === 11 ? "cpf" : "cnpj";
  const phone = digits(person.telefone);
  const ddd = phone.length >= 10 ? phone.slice(0, 2) : "";
  const phoneNumber = phone.length >= 10 ? phone.slice(2) : "";
  return `<${tagName}>
${tomador ? "<tomadorIdentificado>1</tomadorIdentificado>" : ""}
<tipoPessoa>${document.length === 11 ? 1 : 2}</tipoPessoa>
<${documentTag}>${document}</${documentTag}>
${person.inscricaoMunicipal ? `<inscricaoMunicipal>${escapeXml(digits(person.inscricaoMunicipal))}</inscricaoMunicipal>` : ""}
<razaoSocial>${escapeXml(person.razaoSocial)}</razaoSocial>
<endereco>
<logradouro>${escapeXml(person.logradouro)}</logradouro>
${person.complemento ? `<complemento>${escapeXml(person.complemento)}</complemento>` : ""}
<bairro>${escapeXml(person.bairro)}</bairro>
<cep>${digits(person.cep)}</cep>
<codigoMunipio>${escapeXml(person.codigoMunicipio)}</codigoMunipio>
<descricaoMunicipio>${escapeXml(person.descricaoMunicipio)}</descricaoMunicipio>
<codigoEstado>${escapeXml(person.uf)}</codigoEstado>
<descricaoEstado>${escapeXml(person.descricaoUf)}</descricaoEstado>
</endereco>
${person.email ? `<email>${escapeXml(person.email)}</email>` : ""}
${ddd ? `<telefoneDdd>${ddd}</telefoneDdd><telefoneNumero>${phoneNumber}</telefoneNumero>` : ""}
</${tagName}>`;
}

export function buildD2tiSoapEnvelope(input: D2tiEmission) {
  const valor = input.valorTotal.toFixed(2);
  const iss = ((input.valorTotal * input.aliquotaIss) / 100).toFixed(4);
  const header = `<cabecalhoNfseLote xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.ctaconsult.com/nfse"><versao>1.00</versao><ambiente>${input.ambiente === "PRODUCAO" ? 1 : 2}</ambiente></cabecalhoNfseLote>`;
  const nfse = `<nfseLote xmlns="http://www.ctaconsult.com/nfse" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<codigoMunicipio>${D2TI_SAO_MATEUS.codigoTom}</codigoMunicipio>
<dtEmissao>${new Date().toISOString().slice(0, 19)}</dtEmissao>
<notaIntermediada>${input.notaIntermediada}</notaIntermediada>
<autenticacao><token>${escapeXml(input.token)}</token></autenticacao>
${personXml("prestador", input.prestador)}
${personXml("tomador", input.tomador, true)}
<atividadeExecutada>
<codigoServico>${escapeXml(input.codigoServico)}</codigoServico>
<descricaoServico>${escapeXml(input.descricaoServico)}</descricaoServico>
<codigoAtividade>${escapeXml(input.codigoAtividade)}</codigoAtividade>
<descricaoAtividade>${escapeXml(input.descricaoAtividade)}</descricaoAtividade>
<localPrestacao><codigoEstado>${escapeXml(input.prestador.uf)}</codigoEstado><descricaoEstado>${escapeXml(input.prestador.descricaoUf)}</descricaoEstado><codigoMunipio>${D2TI_SAO_MATEUS.codigoTom}</codigoMunipio><descricaoMunicipio>SAO MATEUS DO MARANHAO</descricaoMunicipio></localPrestacao>
<tipoTributacao>${input.tipoTributacao}</tipoTributacao>
<tipoRecolhimento>${input.tipoRecolhimento}</tipoRecolhimento>
<aliquota>${input.aliquotaIss.toFixed(2)}</aliquota>
</atividadeExecutada>
<deducoes><tipo>1</tipo></deducoes>
<detalhamentoNota>
<descricaoNota>${escapeXml(input.discriminacao)}</descricaoNota>
<itensServico><item nItem="1"><tributavel>1</tributavel><descricao>${escapeXml(input.descricaoServico)}</descricao><quantidade>1</quantidade><valorUnitario>${valor}</valorUnitario><valorTotal>${valor}</valorTotal></item></itensServico>
<totais><valotTotalNota>${valor}</valotTotalNota><valorTotalServico>${valor}</valorTotalServico><valorTotalDeducao>0</valorTotalDeducao><valorTotalISS>${iss}</valorTotalISS><valorReducaoBC>0</valorReducaoBC></totais>
</detalhamentoNota>
</nfseLote>`;
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsn="http://wsnfselote.ctaconsult.com.br/"><soapenv:Header/><soapenv:Body><wsn:executar><arg0>${escapeXml(header)}</arg0><arg1>${escapeXml(nfse)}</arg1></wsn:executar></soapenv:Body></soapenv:Envelope>`;
}

export function parseD2tiResponse(raw: string): D2tiResult {
  const decoded = decodeXml(String(raw));
  const inner = tag(decoded, "return") || decoded;
  const codigo = tag(inner, "codigoStatus");
  const message = tag(inner, "descricao") || tag(decoded, "faultstring") || tag(decoded, "Fault");
  if (codigo === "100") {
    const pdfLink = tag(inner, "linkPdfNota");
    return {
      status: "AUTORIZADA",
      protocolo: tag(inner, "protocolo"),
      numero: tag(inner, "numeroNota"),
      codigoVerificacao: tag(inner, "chaveSeguranca"),
      pdfUrl: pdfLink?.startsWith("http") ? pdfLink : pdfLink ? `http://${pdfLink.replace(/^\/+/, "")}` : undefined,
      respostaXml: inner,
    };
  }
  if (codigo === "9999") return { status: "HOMOLOGADA", mensagem: "XML validado em homologação.", respostaXml: inner };
  return { status: "REJEITADA", mensagem: message || "A prefeitura rejeitou a NFS-e.", respostaXml: inner };
}

export async function emitirD2ti(input: D2tiEmission) {
  const envelope = buildD2tiSoapEnvelope(input);
  const response = await axios.post(D2TI_SAO_MATEUS.recepcaoUrl, envelope, {
    headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: "" },
    responseType: "text",
    timeout: 25_000,
    maxRedirects: 0,
  });
  return { envelope, result: parseD2tiResponse(response.data) };
}

export function isD2tiSaoMateus(config: { codigoMunicipioIbge?: string | null; provedorNfse?: string | null; modoEmissaoNfse?: string | null }) {
  // O município não define mais o emissor sozinho. A compatibilidade por
  // provedor atende os registros anteriores à escolha explícita do modo.
  const legacySelected = config.modoEmissaoNfse === "LEGADO_D2TI"
    || (!config.modoEmissaoNfse && config.provedorNfse === D2TI_SAO_MATEUS.provedor);
  return legacySelected && config.codigoMunicipioIbge === D2TI_SAO_MATEUS.codigoIbge;
}
