export const PAYMENT_SETTINGS = Symbol('PAYMENT_SETTINGS');

export interface PaymentSettings {
  /** moeda em que a dívida está expressa (ex.: AOA): `amount_base` e os livros estão sempre nesta moeda */
  baseCurrencyCode: string;
}
