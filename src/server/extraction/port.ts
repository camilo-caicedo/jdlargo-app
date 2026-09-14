export interface ExtractionFieldResult {
  field: string; // mismo namespace que requirements.key tipo 'field'
  value: unknown;
  confidence: number; // 0..1
  location?: { page?: number; area?: string };
}

export interface ExtractionEngineInput {
  documentBytes: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  expectedFields: { key: string; label: string }[]; // de requirements tipo 'field' del counterparty type del expediente
}

export interface ExtractionEngineResult {
  status: 'succeeded' | 'failed';
  provider: string;
  model: string;
  modelVersion: string;
  instructionTemplateId: string;
  instructionTemplateVersion: string;
  dataDestination: string;
  fields?: ExtractionFieldResult[]; // requerido si succeeded
  failureReason?: string; // requerido si failed
}

export interface ExtractionEngine {
  readonly id: string; // p. ej. 'multimodal-fallback'
  extract(input: ExtractionEngineInput): Promise<ExtractionEngineResult>;
}
