import type { WApiClient } from "./wApiClient";
import { mapWApiFetchInstancePayload, mapWApiInstanceStatusFromPayload } from "./whatsappPolicy";

function errorMessage(error: any): string {
  return String(error?.response?.data?.message || error?.message || "Falha ao consultar a W-API").slice(0, 250);
}

// Conexão vem de status-instance; fetch-instance complementa com número e assinatura.
// Uma consulta indisponível não invalida a resposta válida da outra.
export async function readWApiInstance(client: Pick<WApiClient, "status" | "fetchInstance">) {
  const [connection, details] = await Promise.allSettled([client.status(), client.fetchInstance()]);
  const info = details.status === "fulfilled" ? mapWApiFetchInstancePayload(details.value) : null;
  const connectionStatus = connection.status === "fulfilled"
    ? mapWApiInstanceStatusFromPayload(connection.value)
    : "PENDENTE";
  const status = connectionStatus !== "PENDENTE"
    ? connectionStatus
    : info && info.status !== "PENDENTE" ? info.status : null;
  const errors = [
    connection.status === "rejected" ? errorMessage(connection.reason) : null,
    details.status === "rejected" ? errorMessage(details.reason) : null,
    !status ? "A W-API não informou um estado de conexão válido; o último status foi preservado." : null,
  ].filter(Boolean);

  return {
    status,
    connectedPhone: !status ? undefined : status === "DESCONECTADA" ? null : info?.connectedPhone ?? undefined,
    expiresAt: info?.expiresAt ?? null,
    assinaturaStatus: info?.assinaturaStatus ?? null,
    ultimoErro: errors.length ? errors.join("; ").slice(0, 250) : null,
  };
}
