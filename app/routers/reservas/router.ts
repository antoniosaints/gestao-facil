import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { requireReservationPermission as permission } from "../../middlewares/reservasAccess";
import {
  adminAction,
  adminAvailability,
  adminCreateBooking,
  adminDashboard,
  adminDeleteBooking,
  adminDeleteException,
  adminDeleteResource,
  adminDeleteService,
  adminGetConfig,
  adminLinkCustomer,
  adminListBookings,
  adminListExceptions,
  adminListResources,
  adminListServices,
  adminResourceOptions,
  adminRecordPayment,
  adminRefund,
  adminReplaceAvailability,
  adminReschedule,
  adminSaveConfig,
  adminSaveException,
  adminSaveResource,
  adminSaveService,
  adminServiceOptions,
  publicAvailability,
  publicCancel,
  publicCreate,
  publicPreview,
  publicReschedule,
  publicRetryPayment,
  publicServices,
  publicShow,
  publicStore,
} from "../../controllers/reservas/reservas";

const routerReservas = Router();
const handler = (value: any) => value;

routerReservas.get("/publica/:slug", handler(publicStore));
routerReservas.get("/publica/:slug/servicos", handler(publicServices));
routerReservas.get("/publica/:slug/disponibilidade", handler(publicAvailability));
routerReservas.post("/publica/:slug/checkout/preview", handler(publicPreview));
routerReservas.post("/publica/:slug/reservas", handler(publicCreate));
routerReservas.get("/publica/:slug/reservas/:publicId", handler(publicShow));
routerReservas.post("/publica/:slug/reservas/:publicId/remarcar", handler(publicReschedule));
routerReservas.post("/publica/:slug/reservas/:publicId/cancelar", handler(publicCancel));
routerReservas.post("/publica/:slug/reservas/:publicId/retry-payment", handler(publicRetryPayment));

routerReservas.use(authenticateJWT);
routerReservas.get("/config", permission("reservas:configurar"), handler(adminGetConfig));
routerReservas.put("/config", permission("reservas:configurar"), handler(adminSaveConfig));
routerReservas.get("/recursos", permission("reservas:visualizar"), handler(adminListResources));
routerReservas.get("/recursos/select2", permission("reservas:visualizar"), handler(adminResourceOptions));
routerReservas.post("/recursos", permission("reservas:configurar"), handler(adminSaveResource));
routerReservas.patch("/recursos/:id", permission("reservas:configurar"), handler(adminSaveResource));
routerReservas.delete("/recursos/:id", permission("reservas:configurar"), handler(adminDeleteResource));
routerReservas.put(
  "/recursos/:id/disponibilidades",
  permission("reservas:configurar"),
  handler(adminReplaceAvailability),
);
routerReservas.post("/excecoes", permission("reservas:configurar"), handler(adminSaveException));
routerReservas.get("/excecoes", permission("reservas:visualizar"), handler(adminListExceptions));
routerReservas.delete("/excecoes/:id", permission("reservas:configurar"), handler(adminDeleteException));
routerReservas.get("/servicos", permission("reservas:visualizar"), handler(adminListServices));
routerReservas.get("/servicos/select2", permission("reservas:visualizar"), handler(adminServiceOptions));
routerReservas.put("/servicos", permission("reservas:configurar"), handler(adminSaveService));
routerReservas.delete("/servicos/:id", permission("reservas:configurar"), handler(adminDeleteService));
routerReservas.get("/disponibilidade", permission("reservas:visualizar"), handler(adminAvailability));
routerReservas.get("/painel", permission("reservas:visualizar"), handler(adminDashboard));
routerReservas.get("/", permission("reservas:visualizar"), handler(adminListBookings));
routerReservas.post("/", permission("reservas:criar"), handler(adminCreateBooking));
routerReservas.post("/:id/vincular-cliente", permission("reservas:editar"), handler(adminLinkCustomer));
routerReservas.post("/:id/pagamentos", permission("reservas:financeiro"), handler(adminRecordPayment));
routerReservas.post("/:id/remarcar", permission("reservas:editar"), handler(adminReschedule));
routerReservas.post("/:id/estorno", permission("reservas:estornar"), handler(adminRefund));
routerReservas.post("/:id/confirm", permission("reservas:editar"), handler(adminAction));
routerReservas.post("/:id/complete", permission("reservas:editar"), handler(adminAction));
routerReservas.post("/:id/cancel", permission("reservas:cancelar"), handler(adminAction));
routerReservas.delete("/:id", permission("reservas:cancelar"), handler(adminDeleteBooking));

export { routerReservas };
