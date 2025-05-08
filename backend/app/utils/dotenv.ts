import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.string().transform(Number).default("3000"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET é obrigatório"),
  REQUIRED_JWT: z.enum(['true', 'false']).default("true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Erro nas variáveis de ambiente:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
