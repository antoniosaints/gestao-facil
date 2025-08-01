import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { publicKey, signKey } from "../../controllers/impressao/qztray";

const routerPrinter = Router();

routerPrinter.get("/cert/public-key", authenticateJWT, publicKey);
routerPrinter.post("/cert/signature", authenticateJWT, signKey);

export {
    routerPrinter
}