import { buildPublicFileUrl } from "../uploads/fileStorageService";

export async function generatePresignedGetUrl(key: string, _expiresIn = 60, _download = false): Promise<string> {
  return buildPublicFileUrl(key);
}
