import dns from "dns";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type {
  ExtractionEngine,
  ExtractionEngineInput,
  ExtractionEngineResult,
  ExtractionFieldResult,
} from "./port";

// DNS resolution fix for Windows environments
try {
  dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // ignore in non-node or restricted environments
}

export class MultimodalExtractionEngine implements ExtractionEngine {
  readonly id = "multimodal-fallback";

  async extract(input: ExtractionEngineInput): Promise<ExtractionEngineResult> {
    const provider = process.env.AI_EXTRACTION_PROVIDER;
    const model = process.env.AI_EXTRACTION_MODEL;

    if (!provider || !model) {
      return {
        status: "failed",
        provider: provider || "unconfigured",
        model: model || "unconfigured",
        modelVersion: "none",
        instructionTemplateId: "doc_extract_multimodal",
        instructionTemplateVersion: "1.0",
        dataDestination: "unknown",
        failureReason: "Proveedor de IA no configurado (PA-045 pendiente)",
      };
    }

    if (provider !== "google") {
      return {
        status: "failed",
        provider,
        model,
        modelVersion: "none",
        instructionTemplateId: "doc_extract_multimodal",
        instructionTemplateVersion: "1.0",
        dataDestination: "unknown",
        failureReason: `Proveedor no soportado en este motor: ${provider}`,
      };
    }

    try {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });

      // Define extraction schema dynamically based on expectedFields
      const extractionSchema = z.object({
        fields: z.array(
          z.object({
            field: z.string().describe("Nombre o clave del campo extraído"),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe("Valor encontrado en el documento"),
            confidence: z.number().min(0).max(1).describe("Nivel de certeza entre 0.00 y 1.00"),
          }),
        ),
      });

      const fieldPrompt = input.expectedFields
        .map((f) => `- ${f.key}: ${f.label}`)
        .join("\n");

      const systemPrompt = `Eres un asistente experto en extracción de datos de documentos colombianos (SARLAFT/SAGRILAFT).
Tu tarea es extraer los siguientes campos esperados del documento adjunto:
${fieldPrompt}

Para cada campo encontrado, indica su valor exacto y tu nivel de confianza (0.00 a 1.00). Si un campo no está presente en el documento, no lo incluyas o devuélvelo con valor nulo y confianza 0.`;

      const result = await generateObject({
        model: google(model),
        schema: extractionSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: systemPrompt,
              },
              {
                type: "file",
                data: input.documentBytes,
                mediaType: input.mimeType,
              },
            ],
          },
        ],
      });

      const extractedFields: ExtractionFieldResult[] = (result.object.fields || [])
        .filter((f) => f.value !== null && f.value !== undefined)
        .map((f) => ({
          field: f.field,
          value: f.value,
          confidence: f.confidence,
        }));

      return {
        status: "succeeded",
        provider,
        model,
        modelVersion: "1.0",
        instructionTemplateId: "doc_extract_multimodal",
        instructionTemplateVersion: "1.0",
        dataDestination: "US", // Google Generative AI primary destination per terms
        fields: extractedFields,
      };
    } catch (err: unknown) {
      return {
        status: "failed",
        provider,
        model,
        modelVersion: "none",
        instructionTemplateId: "doc_extract_multimodal",
        instructionTemplateVersion: "1.0",
        dataDestination: "unknown",
        failureReason: err instanceof Error ? err.message : "Error desconocido en extracción multimodal",
      };
    }
  }
}

export const defaultMultimodalEngine = new MultimodalExtractionEngine();
