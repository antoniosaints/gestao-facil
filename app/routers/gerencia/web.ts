import { Request, Response, Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { renderAuth } from "../web";

const webAdminRouter = Router();

webAdminRouter.get("/", (req: Request, res: Response): any => {
  res.render("layouts/home", {
    title: "Gerencia",
    layout: "gerencia/main",
  });
});
webAdminRouter.get("/dashboard", authenticateJWT, (req: Request, res: Response): any => {
  renderAuth(req, res, "partials/gerencia/dashboard");
});
webAdminRouter.get("/contas", authenticateJWT, (req: Request, res: Response): any => {
  renderAuth(req, res, "partials/gerencia/contas/index");
});

export { webAdminRouter };