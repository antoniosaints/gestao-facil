import { Router } from 'express';

const webRouter = Router();

webRouter.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

export default webRouter;