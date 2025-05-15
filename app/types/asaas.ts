type billingType = "UNDEFINED" | "BOLETO" | "CREDIT_CARD" | "PIX";
type chargeType = "DETACHED" | "RECURRENT" | "INSTALLMENT";
type subscriptionCycle = "MONTHLY" | "BIMONTHLY" | "WEEKLY" | "BIWEEKLY" | "QUARTERLY" | "SEMIANNUALLY" | "YEARLY";
export interface PaymentLinkPayload {
  name: string;
  description?: string;
  endDate?: string;
  value?: number;
  billingType: billingType;
  chargeType: chargeType;
  dueDateLimitDays?: number;
  subscriptionCycle?: subscriptionCycle;
  maxInstallmentCount?: number;
  externalReference?: string;
  notificationEnabled: boolean;
  callback: { successUrl: string; autoRedirect?: boolean };
  isAddressRequired: boolean;
}
export interface PaymentLinkResponse {
  id: string;
  name: string;
  description: string;
  endDate: string;
  value: number;
  url: string;
  active: boolean;
  billingType: billingType;
  chargeType: chargeType;
  dueDateLimitDays: number;
  subscriptionCycle: subscriptionCycle;
  maxInstallmentCount: number;
  externalReference: string;
  notificationEnabled: boolean;
  isAddressRequired: boolean;
  deleted: boolean;
  viewCount: number;
}
export interface CustomerPayload {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  observations?: string;
}

export interface CustomerResponse {
  object: string;
  id: string;
  dateCreated: string;
  name: string;
  email: string;
  phone: string;
  mobilePhone: string;
  address: string;
  addressNumber: string;
  complement: string;
  province: string;
  city: string;
  cityName: string;
  state: string;
  country: string;
  postalCode: string;
  cpfCnpj: string;
  personType: string;
  deleted: boolean;
  additionalEmails: string;
  externalReference: string;
  notificationDisabled: boolean;
  observations: string;
  foreignCustomer: boolean;
}

export interface ChargePayload {
  customer: string;
  billingType: billingType;
  dueDate: string;
  value: number;
  description?: string;
}

export interface ChargeResponse {
  id: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCodeUrl?: string;
  status: string;
}
