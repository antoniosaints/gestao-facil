import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { downloadCertificate, downloadQztray, getCertificate, signKey } from "../../controllers/impressao/qztray";
import express from "express";

const routerPrinter = Router();

routerPrinter.get("/cert/getCert", authenticateJWT, getCertificate);
routerPrinter.get("/cert/downloadCert", authenticateJWT, downloadCertificate);
routerPrinter.get("/cert/downloadQztray", authenticateJWT, downloadQztray);
routerPrinter.post("/cert/signature", express.text({ type: "*/*" }), signKey);

export {
    routerPrinter
}