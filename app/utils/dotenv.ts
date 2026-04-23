import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalEnvString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalEnvUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    GEMINI_API_KEY: z.string({ required_error: "GEMINI_API_KEY é obrigatório" }),
    BASE_URL: z
      .string({
        required_error: "BASE_URL é obrigatório",
        invalid_type_error: "BASE_URL deve ser uma string",
      })
      .url({
        message: "BASE_URL inválida",
      }),
    PORT: z.string().transform(Number).default("3000"),
    JWT_SECRET: z.string().min(1, "JWT_SECRET é obrigatório"),
    REQUIRED_JWT: z.enum(["true", "false"]).default("true"),
    VAPID_PRIVATE_KEY: z.string({
      required_error: "VAPID_PRIVATE_KEY é obrigatório",
    }),
    VAPID_PUBLIC_KEY: z.string({
      required_error: "VAPID_PUBLIC_KEY é obrigatório",
    }),
    REDIS_HOST: z.string({
      required_error: "REDIS_HOST é obrigatório",
    }),
    REDIS_PORT: z
      .string({
        required_error: "REDIS_PORT é obrigatório",
      })
      .transform(Number),
    REDIS_PASSWORD: z.string({
      required_error: "REDIS_PASSWORD é obrigatório",
    }),
    ASAAS_API_KEY: z.string({
      required_error: "ASAAS_API_KEY é obrigatório",
    }),
    ASAAS_WEBHOOK_SECRET: z.string({
      required_error: "ASAAS_WEBHOOK_SECRET é obrigatório",
    }),
    MP_ACCESS_TOKEN: z.string({
      required_error: "MP_ACCESS_TOKEN é obrigatório",
    }),
    ABACATEPAY_API_KEY: z.string().optional(),
    ABACATEPAY_WEBHOOK_SECRET: z.string().optional(),
    EMAIL_PASSWORD: z.string({
      required_error: "EMAIL_PASSWORD é obrigatório",
    }),
    EMAIL_SENDER: z.string({
      required_error: "EMAIL_SENDER é obrigatório",
    }),
    BASE_URL_FRONTEND: z.string({
      required_error: "BASE_URL_FRONTEND é obrigatório",
    }),
    R2_SECRET_ACCESS_KEY: optionalEnvString,
    R2_ACCESS_KEY_ID: optionalEnvString,
    R2_ENDPOINT: optionalEnvUrl,
    R2_API_ENDPOINT: optionalEnvUrl,
    R2_BUCKET: optionalEnvString,
  })
  .superRefine((data, ctx) => {
    const hasAnyS3Config = Boolean(
      data.R2_SECRET_ACCESS_KEY ||
        data.R2_ACCESS_KEY_ID ||
        data.R2_ENDPOINT ||
        data.R2_API_ENDPOINT ||
        data.R2_BUCKET,
    );

    if (!hasAnyS3Config) return;

    if (!data.R2_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["R2_SECRET_ACCESS_KEY"],
        message: "R2_SECRET_ACCESS_KEY é obrigatório quando o storage S3/R2 está habilitado",
      });
    }

    if (!data.R2_ACCESS_KEY_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["R2_ACCESS_KEY_ID"],
        message: "R2_ACCESS_KEY_ID é obrigatório quando o storage S3/R2 está habilitado",
      });
    }

    if (!data.R2_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["R2_BUCKET"],
        message: "R2_BUCKET é obrigatório quando o storage S3/R2 está habilitado",
      });
    }

    if (!data.R2_ENDPOINT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["R2_ENDPOINT"],
        message: "R2_ENDPOINT é obrigatório para montar URLs públicas dos arquivos",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Erro nas variáveis de ambiente:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
