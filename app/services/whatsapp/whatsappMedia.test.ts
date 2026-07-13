import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import { decryptWhatsAppMedia, extractWhatsAppMediaInfo } from "./whatsappMedia";

// Cifra um buffer no mesmo esquema do WhatsApp para validar o round-trip da descriptografia.
function encryptWhatsAppMedia(plaintext: Buffer, mediaKey: Buffer, info: string): Buffer {
  const expanded = Buffer.from(crypto.hkdfSync("sha256", mediaKey, Buffer.alloc(32), Buffer.from(info), 112));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);
  const cipher = crypto.createCipheriv("aes-256-cbc", cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = crypto
    .createHmac("sha256", macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  return Buffer.concat([ciphertext, mac]);
}

describe("whatsappMedia", () => {
  it("descriptografa mídia cifrada no esquema do WhatsApp (round-trip)", () => {
    const mediaKey = crypto.randomBytes(32);
    const plaintext = Buffer.from("conteúdo-de-teste-da-imagem-🖼️ com bytes variados".repeat(3));
    const encrypted = encryptWhatsAppMedia(plaintext, mediaKey, "WhatsApp Image Keys");

    const decrypted = decryptWhatsAppMedia(encrypted, mediaKey.toString("base64"), "image/jpeg");
    assert.deepEqual(decrypted, plaintext);
  });

  it("aceita a mediaKey como Buffer e usa as chaves de figurinha/imagem", () => {
    const mediaKey = crypto.randomBytes(32);
    const plaintext = Buffer.from("figurinha");
    const encrypted = encryptWhatsAppMedia(plaintext, mediaKey, "WhatsApp Image Keys");

    const decrypted = decryptWhatsAppMedia(encrypted, mediaKey, "image/webp");
    assert.deepEqual(decrypted, plaintext);
  });

  it("rejeita mídia com MAC inválido", () => {
    const mediaKey = crypto.randomBytes(32);
    const encrypted = encryptWhatsAppMedia(Buffer.from("x".repeat(64)), mediaKey, "WhatsApp Image Keys");
    encrypted[encrypted.length - 1] ^= 0xff; // corrompe o último byte do MAC

    assert.throws(() => decryptWhatsAppMedia(encrypted, mediaKey.toString("base64"), "image/jpeg"));
  });

  it("extrai url (via directPath), tipo e mediaKey do payload real da W-API", () => {
    const info = extractWhatsAppMediaInfo({
      msgContent: {
        stickerMessage: {
          URL: "https://mmg.whatsapp.net/v/t62/sticker.enc?ccb=11-4&mms3=true",
          directPath: "/v/t62/sticker.enc",
          mediaKey: "bKnmgnOP3ARz9/KYv5QuT1VxdSNRZ4S5bd2jLjmgT20=",
          mimetype: "image/webp",
        },
      },
    });

    assert.ok(info);
    assert.equal(info?.type, "sticker");
    assert.equal(info?.mimetype, "image/webp");
    assert.ok(info?.url.includes("sticker.enc"));
  });

  it("retorna null quando não há mídia com mediaKey no payload", () => {
    const info = extractWhatsAppMediaInfo({ msgContent: { conversation: "só texto" } });
    assert.equal(info, null);
  });
});
