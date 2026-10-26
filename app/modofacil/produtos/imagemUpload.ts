import multer from "multer";
import { ModoFacilError } from "../errors";

export const uploadImagem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new ModoFacilError(422, "invalid_image", "Envie uma imagem JPEG, PNG ou WebP."));
    }
    cb(null, true);
  },
});
