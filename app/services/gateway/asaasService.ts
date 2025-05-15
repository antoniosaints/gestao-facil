import type {
  CustomerResponse,
  ChargeResponse,
  PaymentLinkResponse,
} from "../../types/asaas";
import Stream from "stream";
import { httpAsaas } from "../../external/http";
import { AsaasCharge, AsaasCustomer, AsaasPaymentLink } from "../../schemas/asaas/asaasSchemas";

// Tipos genéricos
interface List<T> {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

type CustomerList = List<CustomerResponse>;
type ChargeList = List<ChargeResponse>;

interface DeleteRegister {
  deleted: boolean;
  id: string;
}

// Clientes
export async function createCustomer(
  payload: AsaasCustomer
): Promise<CustomerResponse> {
  const { data } = await httpAsaas.post("/customers", payload);
  return data;
}

export async function listCustomers(): Promise<CustomerList> {
  const { data } = await httpAsaas.get("/customers");
  return data;
}

// Cobranças
export async function createCharge(
  payload: AsaasCharge
): Promise<ChargeResponse> {
  const { data } = await httpAsaas.post("/payments", payload);
  return data;
}

export async function listCharges(query: any): Promise<ChargeList> {
  const queryString = Object.entries(query)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const { data } = await httpAsaas.get(`/payments?${queryString}`);
  return data;
}
// Links de pagamento
export async function createLinkPayment(
  payload: AsaasPaymentLink
): Promise<PaymentLinkResponse> {
  const { data } = await httpAsaas.post("/paymentLinks", payload);
  return data;
}

export async function deleteLinkPayment(id: string): Promise<DeleteRegister> {
  const { data } = await httpAsaas.delete(`/paymentLinks/${id}`);
  return data;
}

// Exclusões
export async function deleteCharge(id: string): Promise<DeleteRegister> {
  const { data } = await httpAsaas.delete(`/payments/${id}`);
  return data;
}

export async function deleteSubscription(id: string): Promise<DeleteRegister> {
  const { data } = await httpAsaas.delete(`/subscriptions/${id}`);
  return data;
}

// Boletos (livros de pagamento)
export async function getInstallmentPaymentBook(id: string): Promise<Stream> {
  const { data } = await httpAsaas.get(`/installments/${id}/paymentBook`, {
    responseType: "stream",
  });
  return data;
}

export async function getSubscriptionsPaymentBook(
  id: string,
  month: number,
  year: number
): Promise<Stream> {
  const { data } = await httpAsaas.get(
    `/subscriptions/${id}/paymentBook?month=${month}&year=${year}`,
    {
      responseType: "stream",
    }
  );
  return data;
}
