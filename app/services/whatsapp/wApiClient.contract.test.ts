import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import axios, { AxiosAdapter, AxiosError, InternalAxiosRequestConfig } from "axios";
import { WApiClient } from "./wApiClient";

// Contrato da documentação oficial e coleção Postman, conferido em 18/11/2026.
// O adapter impede qualquer chamada à W-API durante estes testes.
describe("contrato dos endpoints W-API existentes", () => {
  let originalAdapter: typeof axios.defaults.adapter;
  let requests: InternalAxiosRequestConfig[];
  let responseBody: unknown;
  let client: WApiClient;

  beforeEach(() => {
    requests = [];
    responseBody = { error: false };
    originalAdapter = axios.defaults.adapter;
    const adapter: AxiosAdapter = async (config) => {
      requests.push(config);
      return { data: responseBody, status: 200, statusText: "OK", headers: {}, config };
    };
    axios.defaults.adapter = adapter;
    client = new WApiClient("instance-test", "instance-token-test");
  });

  afterEach(() => { axios.defaults.adapter = originalAdapter; });

  function check(method: string, path: string, body?: object, query: object = {}) {
    const config = requests.at(-1)!;
    assert.equal(config.method, method.toLowerCase());
    assert.equal(config.url, path);
    assert.equal(config.headers.get("Authorization"), "Bearer instance-token-test");
    assert.deepEqual(config.params, { ...query, instanceId: "instance-test" });
    if (body) assert.deepEqual(JSON.parse(config.data), body);
  }

  it("cria com apiKey no corpo, sem token de instância ou instanceId", async () => {
    responseBody = { error: false, instanceId: "new-instance", token: "new-token", isTrial: true, status: "PENDING" };
    assert.deepEqual(await WApiClient.createClientInstance({ apiKey: "account-key-test", instanceName: "Loja" }), responseBody);
    const config = requests[0];
    assert.equal(config.method, "post");
    assert.ok(config.url?.endsWith("/v1/client/create-instance"));
    assert.equal(config.params, undefined);
    assert.equal(config.headers.get("Authorization"), undefined);
    assert.deepEqual(JSON.parse(config.data), {
      apiKey: "account-key-test", instanceName: "Loja", lite: true, automaticReading: false, rejectCalls: false,
    });
  });

  for (const [method, path] of [
    ["qrCode", "qr-code"], ["restart", "restart"], ["disconnect", "disconnect"],
    ["status", "status-instance"], ["device", "device"], ["fetchInstance", "fetch-instance"],
  ] as const) {
    it(`valida GET /v1/instance/${path}`, async () => {
      await client[method]();
      check("GET", `/v1/instance/${path}`);
    });
  }

  it("pareia usando o parâmetro obrigatório phoneNumber", async () => {
    await client.pairingCode("5511999999999");
    check("GET", "/v1/instance/pairing-code", undefined, { phoneNumber: "5511999999999" });
    assert.throws(() => client.pairingCode(), /telefone/i);
    assert.equal(requests.length, 1);
  });

  for (const [kind, fields] of [
    ["text", { message: "Olá" }],
    ["image", { image: "https://erp.test/media.png", caption: "Legenda" }],
    ["audio", { audio: "https://erp.test/media.png" }],
    ["video", { video: "https://erp.test/media.png", caption: "Legenda" }],
    ["document", { document: "https://erp.test/media.png", extension: "pdf", fileName: "arquivo.pdf", caption: "Legenda" }],
  ] as const) {
    it(`envia ${kind} sem usar o id local como citação`, async () => {
      await client.send(kind, { phone: "5511999999999", messageId: "erp-local", message: "Olá", mediaUrl: "https://erp.test/media.png", caption: "Legenda", extension: "pdf", fileName: "arquivo.pdf" });
      check("POST", `/v1/message/send-${kind}`, { phone: "5511999999999", delayMessage: 0, ...fields });
    });
  }

  it("envia messageId apenas quando existe uma mensagem citada", async () => {
    await client.send("text", { phone: "5511999999999", messageId: "erp-local", quotedMessageId: "wa-quoted", message: "Resposta" });
    check("POST", "/v1/message/send-text", { phone: "5511999999999", messageId: "wa-quoted", message: "Resposta", delayMessage: 0 });
  });

  it("não envia documento sem a extensão obrigatória", () => {
    assert.throws(() => client.send("document", { phone: "5511999999999", messageId: "erp-local", mediaUrl: "https://erp.test/download" }), /extensão/i);
    assert.equal(requests.length, 0);
  });

  it("preenche a extensão obrigatória nos envios por nome ou link público", async () => {
    await client.send("document", { phone: "5511999999999", messageId: "erp-local", mediaUrl: "https://erp.test/download", fileName: "arquivo.PDF" });
    assert.equal(JSON.parse(requests.at(-1)!.data).extension, "pdf");
    await client.send("document", { phone: "5511999999999", messageId: "erp-local", mediaUrl: "https://erp.test/arquivo.xml?signature=test.pdf" });
    assert.equal(JSON.parse(requests.at(-1)!.data).extension, "xml");
  });

  it("preserva os campos de localização, contato e leitura", async () => {
    const location = { phone: "5511999999999", latitude: "-23.5", longitude: "-46.6", name: "Loja", address: "Rua A, 1" };
    await client.sendLocation(location);
    check("POST", "/v1/message/send-location", { ...location, delayMessage: 0 });
    const contact = { phone: "5511999999999", contactName: "Cliente", contactPhone: "5511888888888", contactBusinessDescription: "Loja" };
    await client.sendContact({ ...contact, quotedMessageId: "wa-quoted" });
    check("POST", "/v1/message/send-contact", { ...contact, messageId: "wa-quoted", delayMessage: 0 });
    await client.readMessage("5511999999999", "wa-message");
    check("POST", "/v1/message/read-message", { phone: "5511999999999", messageId: "wa-message" });
  });

  it("registra os seis webhooks com PUT e value no corpo", async () => {
    const events = { connected: "connected", disconnected: "disconnected", delivery: "delivery", received: "received", status: "message-status", presence: "chat-presence" };
    const urls = Object.fromEntries(Object.keys(events).map(key => [key, `https://erp.test/${key}`]));
    const results = await client.configureWebhooks(urls);
    assert.equal(requests.length, 6);
    for (const [key, suffix] of Object.entries(events)) {
      const config = requests.find(item => item.url === `/v1/webhook/update-webhook-${suffix}`)!;
      assert.ok(config);
      assert.equal(config.method, "put");
      assert.equal(config.headers.get("Authorization"), "Bearer instance-token-test");
      assert.deepEqual(config.params, { instanceId: "instance-test" });
      assert.deepEqual(JSON.parse(config.data), { value: urls[key] });
      assert.equal(results.find(item => item.key === key)?.ok, true);
    }
  });

  for (const [method, path] of [["createPixPayment", "pix/create"], ["createCardSubscription", "card/subscribe"]] as const) {
    it(`mantém POST /v1/payment/${path} com instanceId único`, async () => {
      const input = { payerEmail: "conta@example.com", webhookPaymentUrl: "https://erp.test/payment" };
      await client[method](input);
      check("POST", `/v1/payment/${path}`, input);
    });
  }

  it("rejeita erros de negócio HTTP 200 nas operações existentes", async () => {
    responseBody = { error: true, message: "Instância indisponível" };
    await assert.rejects(client.status(), /Instância indisponível/);
    await assert.rejects(client.send("text", { phone: "5511999999999", messageId: "erp-local", message: "Olá" }), /Instância indisponível/);
    const results = await client.configureWebhooks({ received: "https://erp.test/received" });
    assert.equal(results.find(item => item.key === "received")?.ok, false);
    assert.equal(results.find(item => item.key === "connected")?.skipped, true);
  });

  it("retorna indisponibilidade para o erro real de device sem provisionamento", async () => {
    axios.defaults.adapter = async (config) => {
      throw new AxiosError("Bad Request", "ERR_BAD_REQUEST", config, undefined, {
        status: 400, statusText: "Bad Request", headers: {}, config,
        data: { error: true, message: "A instância instance-test não possui IP ou porta configurados." },
      });
    };
    const unavailable = await new WApiClient("instance-test", "instance-token-test").device();
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.reason, "INSTANCE_NOT_PROVISIONED");
    assert.match(unavailable.message, /indisponíveis/);
    assert.equal(unavailable.connected, undefined);
  });

  for (const status of [400, 401, 403, 500]) {
    it(`não oculta outros erros de device HTTP ${status}`, async () => {
      const failure = new AxiosError("Falha na consulta", "ERR_BAD_RESPONSE");
      axios.defaults.adapter = async (config) => {
        failure.response = { status, statusText: "Erro", headers: {}, config, data: { error: true, message: "Consulta recusada" } };
        throw failure;
      };
      await assert.rejects(new WApiClient("instance-test", "instance-token-test").device(), error => error === failure);
    });
  }
});
