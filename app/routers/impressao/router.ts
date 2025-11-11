import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getCertificate, signKey } from "../../controllers/impressao/qztray";
import express from "express";

const routerPrinter = Router();

routerPrinter.get("/cert/getCert", authenticateJWT, getCertificate);
routerPrinter.post("/cert/signature", express.text({ type: "*/*" }), signKey);

export {
    routerPrinter
}