import axios from "axios";
import { env } from "../../utils/dotenv";

const baseUrl = "https://api.plugnotas.com.br";

function client() {
  if (!env.PLUGNOTAS_API_KEY) throw new Error("PLUGNOTAS_API_KEY não está configurada.");
  return axios.create({ baseURL: baseUrl, timeout: 30_000, headers: { "x-api-key": env.PLUGNOTAS_API_KEY } });
}

export type PlugNotasDocumentType = "NFE" | "NFCE" | "NFSE";

function route(type: PlugNotasDocumentType) {
  return type === "NFE" ? "nfe" : type === "NFCE" ? "nfce" : "nfse";
}

export async function sendPlugNotas(type: PlugNotasDocumentType, payload: unknown) {
  const { data } = await client().post(`/${route(type)}`, payload);
  return data;
}

export async function getPlugNotasSummary(type: PlugNotasDocumentType, providerId: string) {
  const { data } = await client().get(`/${route(type)}/${encodeURIComponent(providerId)}/resumo`);
  return data;
}

/** Consulta idempotente antes de reenviar quando uma falha de rede deixou o resultado incerto. */
export async function getPlugNotasByIntegration(type: PlugNotasDocumentType, cnpj: string, idIntegracao: string) {
  try {
    const { data } = await client().get(`/${route(type)}/${encodeURIComponent(cnpj)}/${encodeURIComponent(idIntegracao)}/resumo`);
    return data;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

export async function requestPlugNotasCancellation(type: PlugNotasDocumentType, providerId: string, motivo: string) {
  const url = type === "NFSE"
    ? `/${route(type)}/cancelar/${encodeURIComponent(providerId)}`
    : `/${route(type)}/${encodeURIComponent(providerId)}/cancelamento`;
  const body = type === "NFSE" ? { codigo: "9", motivo } : { justificativa: motivo };
  const { data } = await client().post(url, body);
  return data;
}

export async function downloadPlugNotas(type: PlugNotasDocumentType, providerId: string, format: "xml" | "pdf") {
  const { data } = await client().get(`/${route(type)}/${encodeURIComponent(providerId)}/${format}`, { responseType: "arraybuffer" });
  return data as ArrayBuffer;
}
