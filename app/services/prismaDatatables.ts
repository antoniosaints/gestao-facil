export type Formatter<T> = (
  value: any,
  row: T,
  meta: { field: string }
) => any | Promise<any>;
export type RowEditor<T> = (row: T, meta: { field: string }) => any;
export type SearchableFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "date"
  | "decimal";

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
  private extraColumns: Record<string, (row: T) => any> = {};
  private alwaysFields: Array<keyof T> = [];

  constructor(model: any) {
    this.model = model;
  }

  addColumn(field: string, callback: (row: T) => Promise<any> | any): this {
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

  include(fields: Array<keyof T>): this {
    this.alwaysFields = fields;
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
    let hasValidFilter = false;

    if (search.value) {
      const dynamicOR = Object.entries(this.searchableFields)
        .map(([field, type]) => {
          try {
            switch (type) {
              case "string":
                return { [field]: { contains: search.value } };
              case "number":
              case "decimal": {
                const val = parseFloat(search.value);
                if (!isNaN(val)) return { [field]: val };
                break;
              }
              case "boolean": {
                const val = search.value.toLowerCase();
                if (val === "true") return { [field]: true };
                if (val === "false") return { [field]: false };
                break;
              }
              case "date": {
                const date = new Date(search.value);
                if (!isNaN(date.getTime())) return { [field]: date };
                break;
              }
              case "enum":
                return { [field]: { contains: search.value } };
            }
          } catch {
            return {};
          }
          return {};
        })
        .filter((f) => {
          if (Object.keys(f).length > 0) {
            hasValidFilter = true;
            return true;
          }
          return false;
        });

      if (hasValidFilter) {
        where = { AND: [this.baseWhere, { OR: dynamicOR }] };
      }
    }

    const recordsTotal = await this.model.count({ where: this.baseWhere });
    const recordsFiltered = hasValidFilter
      ? await this.model.count({ where })
      : recordsTotal;

    const sort = order.map((o) => {
      const field = columns[o.column].data;
      return { [field]: o.dir };
    });

    const rows: T[] = await this.model.findMany({
      where: hasValidFilter ? where : this.baseWhere,
      orderBy: sort,
      skip: start,
      take: length,
    });

    const data = await Promise.all(
      rows.map(async (row) => {
        const formatted: any = {};

        for (const field of this.alwaysFields) {
          formatted[field as string] = (row as any)[field];
        }

        for (const col of columns) {
          const field = col.data as keyof T;
          const meta = { field: field as string };

          if (this.editors[field]) {
            formatted[field] = await this.editors[field](row, meta);
          } else if (this.formatters[field]) {
            const value = (row as any)[field];
            formatted[field] = await this.formatters[field](value, row, meta);
          } else {
            formatted[field] = (row as any)[field];
          }
        }

        for (const [extraField, callback] of Object.entries(
          this.extraColumns
        )) {
          formatted[extraField] = await callback(row);
        }

        return formatted;
      })
    );

    return {
      draw,
      recordsTotal,
      recordsFiltered,
      data,
    };
  }
}
