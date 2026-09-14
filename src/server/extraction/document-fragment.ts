import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DOSSIER_DOCUMENTS_BUCKET } from "@/lib/document-upload-constants";

export interface DocumentFragment {
  bytes: Buffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  hash: string;
}

export async function fetchDocumentFragment(
  storagePath: string,
  format: "pdf" | "jpg" | "png",
): Promise<DocumentFragment> {
  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Error descargando documento para extracción: ${error?.message || "Archivo no encontrado"}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const hash = createHash("sha256").update(bytes).digest("hex");

  let mimeType: "application/pdf" | "image/jpeg" | "image/png";
  switch (format) {
    case "pdf":
      mimeType = "application/pdf";
      break;
    case "jpg":
      mimeType = "image/jpeg";
      break;
    case "png":
      mimeType = "image/png";
      break;
    default:
      throw new Error(`Formato no soportado para extracción: ${format}`);
  }

  return {
    bytes,
    mimeType,
    hash,
  };
}
