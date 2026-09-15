/**
 * Catálogo de tipos de documento soportados por el motor de extracción de IA.
 * Este catálogo define qué tipos de documento pueden ser procesados automáticamente.
 * Si un tipo no está en este catálogo, se marca para revisión manual.
 */

export const DOCUMENT_TYPE_CATALOG = {
  doc_cedula: {
    label: 'Cédula de ciudadanía',
    description: 'Documento nacional de identidad',
  },
  doc_cedula_extranjeria: {
    label: 'Cédula de extranjería',
    description: 'Documento de identidad para extranjeros',
  },
  doc_pasaporte: {
    label: 'Pasaporte',
    description: 'Pasaporte nacional o internacional',
  },
  doc_rut: {
    label: 'RUT',
    description: 'Registro Único Tributario',
  },
  doc_camara_comercio: {
    label: 'Certificado de Cámara de Comercio',
    description: 'Certificación de registro mercantil',
  },
} as const;

export type DocumentTypeKey = keyof typeof DOCUMENT_TYPE_CATALOG;

/**
 * Valida si un tipo de documento está en el catálogo de tipos soportados.
 */
export function isDocumentTypeSupported(documentType: string): documentType is DocumentTypeKey {
  return documentType in DOCUMENT_TYPE_CATALOG;
}

/**
 * Obtiene las opciones del selector para el combobox en la matriz de requisitos.
 */
export function getDocumentTypeOptions() {
  return Object.entries(DOCUMENT_TYPE_CATALOG).map(([key, value]) => ({
    value: key,
    label: value.label,
    description: value.description,
  }));
}
