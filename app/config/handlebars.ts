import { ConfigOptions } from "express-handlebars/types";

export const configOptions: ConfigOptions = {
  extname: "hbs",
  defaultLayout: false,
  helpers: {
    or: (a: any, b: any) => a || b,
    formatMoney: (valor: number) => {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
      }).format(valor);
    },
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