export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

export const DOSSIER_DOCUMENTS_BUCKET = 'dossier-documents';

/**
 * Umbral de confianza provisional para extracción de datos (HU-017 / PA-032 / ADR-0005 §4b).
 * Toda afirmación extraída con confianza menor a este valor se marcará como pendiente de validación
 * humana y no se ofrecerá automáticamente como valor resuelto del expediente.
 * Nota: Es un valor universal provisional hasta que se implemente la tabla de configuración por campo/tarea.
 */
export const EXTRACTION_CONFIDENCE_THRESHOLD = 0.7;
