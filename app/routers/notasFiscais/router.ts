import { Router, type RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { authenticateJWT } from "../../middlewares/auth";
import { requireNotasFiscaisAccess } from "../../middlewares/notasFiscaisAccess";
import { createNfseRps, emitNfse, getFiscalConfig, getNationalMunicipalParameters, listMunicipios, listNfse, saveD2tiToken, saveFiscalConfig, uploadFiscalCertificate } from "../../controllers/notasFiscais/notasFiscais";

export const routerNotasFiscais = Router();
const use = (handler: unknown) => handler as RequestHandler;
const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".pfx") || name.endsWith(".p12")) return callback(null, true);
    return callback(new Error("Envie apenas certificado A1 nos formatos .pfx ou .p12."));
  },
});

routerNotasFiscais.use(authenticateJWT);
routerNotasFiscais.get("/configuracao", requireNotasFiscaisAccess(4), use(getFiscalConfig));
routerNotasFiscais.put("/configuracao", requireNotasFiscaisAccess(4), use(saveFiscalConfig));
routerNotasFiscais.get("/municipios", requireNotasFiscaisAccess(4), use(listMunicipios));
routerNotasFiscais.get("/parametros-municipais", requireNotasFiscaisAccess(4), use(getNationalMunicipalParameters));
routerNotasFiscais.post("/certificado", requireNotasFiscaisAccess(4), (req, res, next) => {
  certificateUpload.single("certificado")(req, res, (error) => {
    if (!error) return next();
    const message = error instanceof MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "O certificado excede o limite de 5MB."
      : error.message;
    return res.status(400).json({ error: { code: "certificate_upload_invalid", message } });
  });
}, use(uploadFiscalCertificate));
routerNotasFiscais.post("/integracao/d2ti/token", requireNotasFiscaisAccess(4), use(saveD2tiToken));
routerNotasFiscais.get("/nfs-e", requireNotasFiscaisAccess(3), use(listNfse));
routerNotasFiscais.post("/nfs-e/rps", requireNotasFiscaisAccess(4), use(createNfseRps));
routerNotasFiscais.post("/nfs-e/emitir", requireNotasFiscaisAccess(4), use(emitNfse));
