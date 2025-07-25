import { MercadoPagoConfig, Order, Payment, Preference } from 'mercadopago';
import { env } from './dotenv';

const mercadoPago = new MercadoPagoConfig({
  accessToken: env.MP_ACCESS_TOKEN as string,
});

const mercadoPagoOrder = new Order(mercadoPago);
const mercadoPagoPayment = new Payment(mercadoPago);
const mercadoPagoPreference = new Preference(mercadoPago);

export { mercadoPagoOrder, mercadoPagoPayment, mercadoPagoPreference };