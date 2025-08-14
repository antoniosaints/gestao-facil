import { Request, Response, Router } from "express";
const webAdminRouter = Router();

webAdminRouter.get("/", (req: Request, res: Response): any => {
  const isHTMX = req.headers["hx-request"];
  res.render("partials/gerencia/dashboard", {
    layout: isHTMX ? false : "gerencia/main",
  });
});
webAdminRouter.get(
  "/contas",
  (req: Request, res: Response): any => {
    const isHTMX = req.headers["hx-request"];
    res.render("partials/gerencia/contas/index", {
      layout: isHTMX ? false : "gerencia/main",
    })
  }
);

export { webAdminRouter };
