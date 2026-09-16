import axios from "axios";
import { env } from "../../utils/dotenv";

export type GeranetDocumentType = "NFE" | "NFCE";

export type GeranetResponse = {
  situacao?: string;
  mensagem?: string;
  cstat?: string;
  numero?: string;
  chave?: string;
  protocolo?: string;
  xml?: string;
  pdf?: string;
};

function client() {
  if (!env.GERANET_NFE_API_KEY) throw new Error("GERANET_NFE_API_KEY não está configurada.");
  return axios.create({
    baseURL: env.GERANET_NFE_BASE_URL,
    timeout: 120_000,
    headers: { Authorization: `Bearer ${env.GERANET_NFE_API_KEY}`, Accept: "application/json" },
  });
}

export async function emitGeranetNfe(payload: unknown) {
  const { data } = await client().post<GeranetResponse>("/nfe/emitir", payload);
  return data;
}

export async function emitGeranetNfse(payload: unknown) {
  const { data } = await client().post<GeranetResponse>("/nfse/emitir", payload);
  return data;
}

export async function cancelGeranetNfe(payload: unknown) {
  const { data } = await client().post<GeranetResponse>("/nfe/cancelar", payload);
  return data;
}

export async function cancelGeranetNfse(payload: unknown) {
  const { data } = await client().post<GeranetResponse>("/nfse/cancelar", payload);
  return data;
}

export async function getGeranetUser() {
  const { data } = await client().get("/user");
  return data;
}

/**
 * A API não oferece consulta de NF-e emitida por chave. Em caso de timeout,
 * os logs são a fonte de reconciliação disponível, sempre filtrados pelo CNPJ.
 */
export async function listGeranetLogs(params: { cnpj: string; dataDe: string; dataAte: string }) {
  const { data } = await client().get("/logs", {
    params: { cnpj: params.cnpj, data_de: params.dataDe, data_ate: params.dataAte, por_pagina: 100 },
  });
  return data;
}
