import type { FastifyRequest } from "fastify";
import type {} from "@fastify/multipart";
import { ValidationError } from "@vennora/core/errors";

/**
 * Lecture d'un envoi `multipart/form-data` : champs texte et fichier.
 *
 * Le nom et le type annoncés par le navigateur sont rendus pour information
 * seulement : le type réel est établi par `storeFile` d'après la signature
 * binaire, et le nom d'origine ne sert jamais à construire un chemin.
 */

/** Une photo de téléphone, même compressée, dépasse vite le mégaoctet. */
export const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

export interface UploadedFile {
  field: string;
  filename: string;
  mimetype: string;
  body: Buffer;
}

export async function readMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  if (!request.isMultipart()) {
    throw new ValidationError("Envoi invalide : un formulaire avec fichier est attendu.");
  }

  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  for await (const part of request.parts({ limits: { fileSize: UPLOAD_MAX_BYTES, files: 4 } })) {
    if (part.type === "file") {
      let body: Buffer;
      try {
        body = await part.toBuffer();
      } catch (e) {
        if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
          throw new ValidationError(
            `Fichier trop volumineux (${UPLOAD_MAX_BYTES / 1024 / 1024} Mo maximum).`,
          );
        }
        throw e;
      }
      if (part.file.truncated) {
        throw new ValidationError(
          `Fichier trop volumineux (${UPLOAD_MAX_BYTES / 1024 / 1024} Mo maximum).`,
        );
      }
      if (body.length > 0) {
        files.push({ field: part.fieldname, filename: part.filename, mimetype: part.mimetype, body });
      }
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, files };
}
