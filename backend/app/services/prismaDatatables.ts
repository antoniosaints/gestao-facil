export type Formatter<T> = (value: any, row: T, meta: { field: string }) => any;
export type RowEditor<T> = (row: T, meta: { field: string }) => any;
export type SearchableFieldType = "string" | "number" | "boolean";
export interface DataTablesRequest {
  draw: number;
  start: number;
  length: number;
  search: {
    value: string;
    regex?: boolean;
  };
  order: Array<{
    column: number;
    dir: "asc" | "desc";
  }>;
  columns: Array<{
    data: string;
    name: string;
    searchable: boolean;
    orderable: boolean;
    search: {
      value: string;
      regex?: boolean;
    };
  }>;
}

export interface DataTablesResponse<T> {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
  error?: string;
}

export class PrismaDataTableBuilder<T> {
  private formatters: Record<keyof T, Formatter<T>> = {} as Record<
    keyof T,
    Formatter<T>
  >;
  private editors: Record<keyof T, RowEditor<T>> = {} as Record<
    keyof T,
    RowEditor<T>
  >;
  private searchableFields: Partial<Record<keyof T, SearchableFieldType>> = {};
  private baseWhere: any = {};
  private model: any;
  private extraColumns: Record<string, (row: T) => any> = {}; // Agora armazena funções

  constructor(model: any) {
    this.model = model;
  }
  addColumn(field: string, callback: (row: T) => any): this {
    this.extraColumns[field] = callback;
    return this;
  }
  search(fields: Partial<Record<keyof T, SearchableFieldType>>): this {
    this.searchableFields = fields;
    return this;
  }

  where(condition: any): this {
    this.baseWhere = condition;
    return this;
  }

  edit(field: keyof T, callback: RowEditor<T>): this {
    this.editors[field] = callback;
    return this;
  }

  format(field: keyof T, callback: Formatter<T>): this {
    this.formatters[field] = callback;
    return this;
  }

  private parseQuery(query: any): DataTablesRequest {
    const columns = Object.keys(query)
      .filter((k) => k.startsWith("columns"))
      .reduce((acc: any[], key) => {
        const match = key.match(/columns\[(\d+)]\[(\w+)]/);
        if (!match) return acc;
        const [_, index, prop] = match;
        acc[+index] = acc[+index] || {};
        acc[+index][prop] = query[key];
        return acc;
      }, []);

    const order = Object.keys(query)
      .filter((k) => k.startsWith("order"))
      .reduce((acc: any[], key) => {
        const match = key.match(/order\[(\d+)]\[(\w+)]/);
        if (!match) return acc;
        const [_, index, prop] = match;
        acc[+index] = acc[+index] || {};
        acc[+index][prop] =
          prop === "column" ? parseInt(query[key], 10) : query[key];
        return acc;
      }, []);

    return {
      draw: parseInt(query.draw, 10) || 0,
      start: parseInt(query.start, 10) || 0,
      length: parseInt(query.length, 10) || 10,
      search: { value: query["search[value]"] || "" },
      order,
      columns,
    };
  }

  async toJson(query: any): Promise<DataTablesResponse<any>> {
    const req = this.parseQuery(query);
    const { draw, start, length, search, order, columns } = req;

    let where: any = this.baseWhere;

    if (search.value) {
      const dynamic = {
        OR: Object.entries(this.searchableFields)
          .map(([field, type]) => {
            if (type === "string") {
              return {
                [field]: { contains: search.value },
              };
            }
            if (type === "number") {
              // Tentar converter o valor de busca para número
              const searchNumber = parseFloat(search.value);
              if (!isNaN(searchNumber)) {
                return { [field]: searchNumber }; // Comparação exata para números
              }
            }
            if (type === "boolean") {
              const val = search.value.toLowerCase();
              if (val === "true") return { [field]: true };
              if (val === "false") return { [field]: false };
            }
            return {};
          })
          .filter((f) => Object.keys(f).length > 0),
      };
      where = { AND: [this.baseWhere, dynamic] };
    }

    const recordsTotal = await this.model.count({
      where: this.baseWhere,
    });

    const recordsFiltered = await this.model.count({
      where,
    });

    const sort = order.map((o) => {
      const field = columns[o.column].data;
      return { [field]: o.dir };
    });

    const rows: T[] = await this.model.findMany({
      where,
      orderBy: sort,
      skip: start,
      take: length,
    });

    const data = rows.map((row) => {
      const formatted: any = {};
      for (const col of columns) {
        const field = col.data as keyof T;
        const meta = { field: field as string }; // Convertendo 'field' para string

        // Verifica se o campo está configurado para ser formatado
        if (this.editors[field]) {
          formatted[field] = this.editors[field](row, meta);
        } else if (this.formatters[field]) {
          const value = (row as any)[field]; // Referencia o campo dinamicamente
          formatted[field] = this.formatters[field](value, row, meta);
        } else {
          formatted[field] = (row as any)[field]; // Retorna o valor original se não houver formatação
        }
      }

      // Adiciona as colunas extras aqui
      for (const [extraField, callback] of Object.entries(this.extraColumns)) {
        formatted[extraField] = callback(row);
      }

      return formatted;
    });

    return {
      draw,
      recordsTotal,
      recordsFiltered,
      data,
    };
  }
}
