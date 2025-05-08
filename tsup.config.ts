// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["app/server.ts"],
  outDir: "dist",
  target: "node18",
  format: ["cjs"],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false, // gera os arquivos .d.ts
  minify: true, // true se quiser minimizar
});
