import type { RequestHandler, Router } from "express";

/** Diagnóstico da instância pertence ao WhatsApp; replay altera o Atendimento. */
export function registerInstanceWebhookLogRoutes(router: Router, handlers: {
  list: RequestHandler;
  retry: RequestHandler;
  atendimentoAccess: RequestHandler;
}) {
  router.get("/instances/:id/eventos", handlers.list);
  router.post("/instances/:id/eventos/:eventoId/retry", handlers.atendimentoAccess, handlers.retry);
}
