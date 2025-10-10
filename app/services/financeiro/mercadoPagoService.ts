import { MercadoPagoConfig, Order, Payment, Preference } from 'mercadopago'

export class MercadoPagoService {
  private readonly config: MercadoPagoConfig

  public readonly order: Order
  public readonly payment: Payment
  public readonly preference: Preference

  constructor(apiKey: string) {
    this.config = new MercadoPagoConfig({ accessToken: apiKey })
    this.order = new Order(this.config)
    this.payment = new Payment(this.config)
    this.preference = new Preference(this.config)
  }
}
