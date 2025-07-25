import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
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
  REDIS_PORT: z.string({
    required_error: "REDIS_PORT é obrigatório",
  }).transform(Number),
  REDIS_PASSWORD: z.string({
    required_error: "REDIS_PASSWORD é obrigatório",
  }),
  ASAAS_API_KEY: z.string({
    required_error: "ASAAS_API_KEY é obrigatório",
  }),
  ASAAS_WEBHOOK_SECRET: z.string({
    required_error: "ASAAS_WEBHOOK_SECRET é obrigatório",
  }),
  ASAAS_BASE_URL: z.string({
    required_error: "ASAAS_BASE_URL é obrigatório",
  }),
  MP_ACCESS_TOKEN: z.string({
    required_error: "MP_ACCESS_TOKEN é obrigatório",
  })
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Erro nas variáveis de ambiente:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
