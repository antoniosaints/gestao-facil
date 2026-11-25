import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { authenticateJWT } from "../../middlewares/auth";
import { emprestimoPublicoLimiter } from "../../middlewares/rateLimit";
import { AppRequirementError } from "../../utils/appRequirementError";
import { handleError } from "../../utils/handleError";
import { clampPageSize, parsePage, sanitizeOrder } from "../../utils/pagination";
import { aprovarSchema, baixaSchema, configSchema, cotacaoSchema, criarSchema, diasSimulacaoSchema, filtrosTabelaSchema, pagamentoSchema, simularCriacaoSchema } from "../../services/emprestimos/schemas";
import {
  abrirPagamento, aprovarComprovante, cancelarPixManual, consultarPagamento, consultarPagamentoAdmin, cotarBaixa, criarEmprestimo,
  detalheEmprestimo, enviarComprovante, estadoPublico, excluirEmprestimo, lerComprovante, lerConfig, listarEmprestimos,
  registrarBaixa, salvarConfig, simularCriacaoEmprestimo, simularEmprestimo, tabelaEmprestimos, validarWebhook, webhookGateway,
} from "../../services/emprestimos/service";

export const routerEmprestimos = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fields: 0, fileSize: 3 * 1024 * 1024 } });
const idInvalido = "Informe um número de empréstimo válido.";
const id = z.coerce.number({ invalid_type_error: idInvalido }).int(idInvalido).positive(idInvalido).max(2_147_483_647, idInvalido);
const uuid = z.string().uuid();
const token = (req: Request) => z.string().regex(/^[a-f0-9]{64}$/, "Link de empréstimo inválido.").parse(req.params.token);

const handler = (operation: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try {
      const data = await operation(req, res);
      if (!res.headersSent) res.json({ data });
    } catch (error) {
      handleError(res, error);
    }
  };

const admin = (level: number, operation: (req: Request, res: Response, contaId: number) => Promise<unknown>) =>
  handler(async (req, res) => {
    const customData = getCustomRequest(req).customData;
    if (!(await hasPermission(customData, level))) {
      throw new AppRequirementError("Você não tem permissão para esta operação.", "emprestimo_permissao", 403);
    }
    return operation(req, res, customData.contaId);
  });

routerEmprestimos.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
  next();
});

routerEmprestimos.get("/publico/:token", handler((req) => estadoPublico(token(req))));
routerEmprestimos.post("/publico/:token/pagamento", emprestimoPublicoLimiter, handler((req) =>
  abrirPagamento(token(req), pagamentoSchema.parse(req.body))));
routerEmprestimos.post("/publico/:token/pagamentos/:pagamentoId/consultar", emprestimoPublicoLimiter, handler((req) =>
  consultarPagamento(token(req), uuid.parse(req.params.pagamentoId))));
routerEmprestimos.post("/publico/:token/pagamentos/:pagamentoId/cancelar-gateway", emprestimoPublicoLimiter, handler((req) =>
  consultarPagamento(token(req), uuid.parse(req.params.pagamentoId), true)));
routerEmprestimos.post("/publico/:token/pagamentos/:pagamentoId/comprovante", emprestimoPublicoLimiter, (req, res, next) => {
  upload.single("comprovante")(req, res, (error) => {
    if (!error) return next();
    res.status(422).json({ message: "Envie um único comprovante em PDF, JPG ou PNG de até 3 MB." });
  });
}, handler((req) => enviarComprovante(token(req), uuid.parse(req.params.pagamentoId), req.file?.buffer)));

routerEmprestimos.use(authenticateJWT);
routerEmprestimos.get("/config", admin(4, (_req, _res, contaId) => lerConfig(contaId)));
routerEmprestimos.put("/config", admin(4, (req, _res, contaId) => salvarConfig(contaId, configSchema.parse(req.body))));
async function responderTabela(req: Request, res: Response, contaId: number) {
  const { search, page, pageSize, sortBy, order } = req.query;
  const filtros = filtrosTabelaSchema.parse(req.query);
  res.json(await tabelaEmprestimos(contaId, {
    ...filtros,
    busca: typeof search === "string" ? search.trim().slice(0, 120) : "",
    page: parsePage(page),
    pageSize: Math.max(1, clampPageSize(pageSize)),
    sortBy,
    order: sanitizeOrder(order),
  }));
}
routerEmprestimos.get("/", admin(3, (req, res, contaId) => {
  if (req.query.page !== undefined || req.query.pageSize !== undefined) return responderTabela(req, res, contaId);
  return listarEmprestimos(
    contaId, z.string().trim().max(120).parse(req.query.busca ?? ""), id.optional().parse(req.query.cursor),
  );
}));
routerEmprestimos.get("/getDataTable", admin(3, responderTabela));
routerEmprestimos.post("/simulacao", admin(3, (req, _res, contaId) => simularCriacaoEmprestimo(contaId, simularCriacaoSchema.parse(req.body))));
routerEmprestimos.post("/", admin(3, (req, _res, contaId) => criarEmprestimo(contaId, criarSchema.parse(req.body))));
routerEmprestimos.get("/:id", admin(3, (req, _res, contaId) => detalheEmprestimo(contaId, id.parse(req.params.id))));
routerEmprestimos.post("/:id/simulacao", admin(3, (req, _res, contaId) =>
  simularEmprestimo(contaId, id.parse(req.params.id), diasSimulacaoSchema.parse(req.body).dias)));
routerEmprestimos.delete("/:id", admin(4, (req, _res, contaId) =>
  excluirEmprestimo(contaId, id.parse(req.params.id))));
routerEmprestimos.post("/:id/cotacao", admin(3, (req, _res, contaId) =>
  cotarBaixa(contaId, id.parse(req.params.id), cotacaoSchema.parse(req.body))));
routerEmprestimos.post("/:id/baixas", admin(3, (req, _res, contaId) =>
  registrarBaixa(contaId, id.parse(req.params.id), baixaSchema.parse(req.body))));
routerEmprestimos.post("/:id/pagamentos/:pagamentoId/aprovar", admin(3, (req, _res, contaId) =>
  aprovarComprovante(contaId, id.parse(req.params.id), uuid.parse(req.params.pagamentoId), aprovarSchema.parse(req.body))));
routerEmprestimos.post("/:id/pagamentos/:pagamentoId/cancelar-pix", admin(3, (req, _res, contaId) =>
  cancelarPixManual(contaId, id.parse(req.params.id), uuid.parse(req.params.pagamentoId))));
routerEmprestimos.post("/:id/pagamentos/:pagamentoId/consultar-gateway", admin(3, (req, _res, contaId) =>
  consultarPagamentoAdmin(contaId, id.parse(req.params.id), uuid.parse(req.params.pagamentoId))));
routerEmprestimos.get("/:id/pagamentos/:pagamentoId/comprovante", admin(3, async (req, res, contaId) => {
  const arquivo = await lerComprovante(contaId, id.parse(req.params.id), uuid.parse(req.params.pagamentoId));
  const extensao = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[arquivo.tipo];
  res.attachment(`comprovante.${extensao}`).type(arquivo.tipo).set("X-Content-Type-Options", "nosniff").send(Buffer.from(arquivo.conteudo));
}));

export const webhookEmprestimos = handler(async (req, res) => {
  const reference = uuid.safeParse(req.params.pagamentoId);
  const eventType = req.body?.type ?? req.query.type;
  const resource = req.body?.data?.id ?? req.query["data.id"];
  if (reference.success && validarWebhook(reference.data, String(req.params.assinatura)) && eventType === "payment" && /^\d{1,20}$/.test(String(resource))) {
    await webhookGateway(reference.data, String(resource));
  }
  res.sendStatus(200);
});
