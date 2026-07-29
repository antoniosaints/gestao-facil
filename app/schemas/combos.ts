import { z } from "zod";

export const comboComponenteSchema = z.object({
  tipo: z.enum(["PRODUTO", "SERVICO"]),
  id: z.number().int().positive(),
  quantidade: z.number().int().positive().max(999999),
});

const comboBaseSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().trim().max(4000).optional().nullable(),
  imagem: z.string().trim().max(2048).optional().nullable(),
  preco: z.number().positive().max(99999999.99),
  ativo: z.boolean().optional().default(true),
  mostrarNoPdv: z.boolean().optional().default(true),
  mostrarOnline: z.boolean().optional().default(true),
  componentes: z.array(comboComponenteSchema).min(1).max(100),
});

function validateDuplicates(
  componentes: z.infer<typeof comboComponenteSchema>[] | undefined,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  componentes?.forEach((item, index) => {
    const key = `${item.tipo}:${item.id}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["componentes", index],
        message: "O mesmo item não pode aparecer duas vezes no combo.",
      });
    }
    seen.add(key);
  });
}

export const comboSchema = comboBaseSchema.superRefine((data, ctx) => {
  validateDuplicates(data.componentes, ctx);
});

export const comboUpdateSchema = comboBaseSchema.partial().superRefine((data, ctx) => {
  validateDuplicates(data.componentes, ctx);
  if (Object.keys(data).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe ao menos um campo para atualizar." });
  }
});

export const comboChannelSchema = z.enum(["PDV", "VENDA", "OS", "COMANDA"]);

export type ComboInput = z.infer<typeof comboSchema>;
