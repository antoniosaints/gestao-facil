declare module "json2csv" {
  export function parse<T>(data: T[], options?: { fields: string[], delimiter: string }): string;
}
