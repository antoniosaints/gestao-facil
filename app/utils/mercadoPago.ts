import { env } from './dotenv';
import { MercadoPagoService } from '../services/financeiro/mercadoPagoService';

const saasMercadoPago = new MercadoPagoService(env.MP_ACCESS_TOKEN as string);

const mercadoPagoOrder = saasMercadoPago.order;
const mercadoPagoPayment = saasMercadoPago.payment;
const mercadoPagoPreference = saasMercadoPago.preference;

function getSaasMercadoPagoService() {
  return saasMercadoPago;
}

export {
  getSaasMercadoPagoService,
  mercadoPagoOrder,
  mercadoPagoPayment,
  mercadoPagoPreference,
};
