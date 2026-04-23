import { ConfigOptions } from "express-handlebars/types";
import { formatCurrencyBR } from "../helpers/formatters";

export const configOptions: ConfigOptions = {
  extname: "hbs",
  defaultLayout: false,
  helpers: {
    or: (a: any, b: any) => a || b,
    formatMoney: (valor: number) => formatCurrencyBR(valor),
    ifEquals: (a: any, b: any, opt: any) => {
      return a === b ? opt.fn(this) : opt.inverse(this);
    },
    hasPermission: (level: any, required: any, opt: any) => {
      return level >= required ? opt.fn(this) : opt.inverse(this);
    },
    valueExists: (value: any, textTrue: string, textFalse: string) => {
      if (
        typeof value !== "undefined" &&
        value !== null &&
        value !== "" &&
        value !== "null"
      ) {
        return textTrue;
      } else {
        return textFalse;
      }
    },
  },
};
