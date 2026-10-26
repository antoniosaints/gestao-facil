import { test } from "node:test";
import assert from "node:assert/strict";
import { substituirImagemVariante } from "../../services/produtos/produtoImagemService";
import { uploadImagem } from "../produtos/imagemUpload";
import { database } from "./fixtures";
import express from "express";
import type { AddressInfo } from "node:net";
import { once } from "node:events";

test("upload falho mantém imagem antiga e não cria produto", async () => {
  const removed: string[] = []; let touched = false;
  await assert.rejects(substituirImagemVariante({ produto: { updateMany: async () => { touched = true; } } } as any, 1, { id: 2, imagem: "antiga" }, {
    upload: async () => { throw new Error("storage indisponível"); }, remove: async ref => { removed.push(ref); },
  }));
  assert.equal(touched, false); assert.deepEqual(removed, []);
});
test("imagem é trocada antes da limpeza; falha no banco limpa só o upload novo", async () => {
  const events: string[] = [];
  const storage = { upload: async () => { events.push("upload"); return { reference: "nova", url: "https://example.test/nova" }; }, remove: async (ref: string) => { events.push("remove:" + ref); } };
  const db = { produto: { updateMany: async (input: any) => { events.push("db"); assert.equal(input.where.imagem, "antiga"); assert.equal(input.where.contaId, 1); return { count: 1 }; } } } as any;
  const result = await substituirImagemVariante(db, 1, { id: 2, imagem: "antiga" }, storage);
  assert.equal(result.imagem, "nova"); assert.deepEqual(events, ["upload", "db", "remove:antiga"]);
  events.length = 0; db.produto.updateMany = async () => { events.push("db"); throw new Error("DB falhou"); };
  await assert.rejects(substituirImagemVariante(db, 1, { id: 2, imagem: "antiga" }, storage));
  assert.deepEqual(events, ["upload", "db", "remove:nova"]);
});
test("troca concorrente de imagem retorna 409 e preserva a referência vencedora", async () => {
  const d = database(); d.state().variants.push({ id: 201, contaId: 1, imagem: "vencedora" }); const removed: string[] = [];
  await assert.rejects(substituirImagemVariante(d.db, 1, { id: 201, imagem: "antiga" }, {
    upload: async () => ({ reference: "nova", url: "https://example.test/nova" }), remove: async ref => { removed.push(ref); },
  }), { status: 409 });
  assert.equal(d.state().variants[0].imagem, "vencedora"); assert.deepEqual(removed, ["nova"]);
});
test("multipart usa file, aceita JPEG/PNG/WebP e bloqueia acima de 5 MiB", async t => {
  const app = express();
  app.post("/foto", uploadImagem.single("file"), (req, res) => { res.json({ size: req.file?.size }); });
  app.use((error: any, _req: any, res: any, _next: any) => { res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status ?? 422).json({ code: error.code }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/foto`;
  const send = (bytes: number, type: string) => {
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)], { type }), "foto"); return fetch(endpoint, { method: "POST", body: form });
  };
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) assert.equal((await send(20, mime)).status, 200);
  assert.equal((await send(5 * 1024 * 1024 + 1, "image/jpeg")).status, 413);
  assert.equal((await send(20, "image/svg+xml")).status, 422);
});
