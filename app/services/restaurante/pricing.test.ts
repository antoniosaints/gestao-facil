import assert from "node:assert/strict";
import test from "node:test";
import { calcularFrete, calcularPrecoUnitario } from "./pricing";

test("usa o maior adicional entre sabores", () => {
  const valor = calcularPrecoUnitario(30, [
    { tipo: "SABOR", nome: "Calabresa", precoAdicional: 4 },
    { tipo: "SABOR", nome: "Especial", precoAdicional: 7 },
    { tipo: "COMPLEMENTO", nome: "Borda", precoAdicional: 5 },
  ], "MAIOR_PRECO");
  assert.equal(valor.toNumber(), 42);
});

test("calcula media proporcional e valida os pesos", () => {
  const valor = calcularPrecoUnitario(30, [
    { tipo: "SABOR", nome: "A", precoAdicional: 4, proporcao: 0.5 },
    { tipo: "SABOR", nome: "B", precoAdicional: 8, proporcao: 0.5 },
  ], "MEDIA_PROPORCIONAL");
  assert.equal(valor.toNumber(), 36);
  assert.throws(() => calcularPrecoUnitario(30, [
    { tipo: "SABOR", nome: "A", precoAdicional: 4, proporcao: 0.8 },
    { tipo: "SABOR", nome: "B", precoAdicional: 8, proporcao: 0.8 },
  ], "MEDIA_PROPORCIONAL"));
});

test("zera o frete ao atingir a faixa gratuita", () => {
  assert.equal(calcularFrete({ subtotal: 80, taxaFixa: 9, freteGratisAcima: 80 }).toNumber(), 0);
  assert.equal(calcularFrete({ subtotal: 79.99, taxaFixa: 9, freteGratisAcima: 80 }).toNumber(), 9);
});
