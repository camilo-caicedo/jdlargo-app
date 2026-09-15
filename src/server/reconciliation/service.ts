import { DrizzleClient } from '../db/client';
import { getActiveAssertionsForDossier, type AssertionDetail } from '../assertions/service';
import { getDossierPendingRequirements } from '../dossiers/dossier';
import { isRequirementCurrentlyRequired } from '@/lib/requirement-evaluation';

// normalizeValue/areValuesEqual viven en src/lib/value-comparison.ts (sin dependencias de
// servidor) para poder reutilizarlas tambien desde componentes cliente del portal.
import { normalizeValue, areValuesEqual } from '@/lib/value-comparison';
export { normalizeValue, areValuesEqual };

export interface OpenDiscrepancy {
  field: string;
  assertionIds: string[]; // todas las afirmaciones activas en conflicto para ese campo
  isBlocking: boolean;    // campo actualmente exigido (isRequirementCurrentlyRequired)
}

export type FieldReconciliationStatus = 'concordante' | 'discrepancia';

export interface FieldReconciliationRow {
  field: string;
  declaredValue: unknown | null;
  declaredAssertionId: string | null;
  extractedValue: unknown | null;
  extractedAssertionId: string | null;
  extractedSource: string | null;      // evidenceId (documento) de la afirmación extraída
  extractedConfidence: string | null;
  extractedStatus: 'pending_validation' | 'active' | 'discarded' | null; // Estado de la afirmación extraída
  status: FieldReconciliationStatus;
  requiredAction: string;              // 'Ninguna' | 'Resolver discrepancia'
  isBlocking: boolean;
}

/**
 * Evaluates which active assertions are currently in conflict (open discrepancies).
 * A discrepancy exists when a field has 2 or more active assertions with distinct normalized values.
 */
export async function getOpenDiscrepancies(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<OpenDiscrepancy[]> {
  const activeAssertions = await getActiveAssertionsForDossier(organizationId, dossierId, txClient);

  // Group active assertions by field
  const byField = new Map<string, AssertionDetail[]>();
  for (const assertion of activeAssertions) {
    const list = byField.get(assertion.field) || [];
    list.push(assertion);
    byField.set(assertion.field, list);
  }

  // Load requirements to determine if fields are currently required / blocking
  let requirements: Awaited<ReturnType<typeof getDossierPendingRequirements>> = [];
  try {
    requirements = await getDossierPendingRequirements(organizationId, dossierId, txClient);
  } catch {
    // If dossier lacks counterparty type or requirements cannot be loaded, fallback to empty
    requirements = [];
  }

  // Build values dictionary for condition evaluation
  const latestValues: Record<string, unknown> = {};
  for (const assertion of activeAssertions) {
    if (!(assertion.field in latestValues)) {
      latestValues[assertion.field] = assertion.value;
    }
  }

  const fieldReqMap = new Map<string, (typeof requirements)[number]>();
  for (const req of requirements) {
    if (req.type === 'field') {
      fieldReqMap.set(req.key, req);
    }
  }

  const discrepancies: OpenDiscrepancy[] = [];

  for (const [field, assertionsList] of byField.entries()) {
    if (assertionsList.length < 2) {
      continue;
    }

    // Check if any pairs have different values
    const firstVal = assertionsList[0].value;
    const hasDifference = assertionsList.some((a) => !areValuesEqual(a.value, firstVal));

    if (hasDifference) {
      const req = fieldReqMap.get(field);
      // As specified in Blueprint §2: all discrepancies on currently required fields
      // (mandatory !== 'optional' and condition met) are treated as blocking without exception.
      let isBlocking = false;
      if (req) {
        isBlocking = isRequirementCurrentlyRequired(req, latestValues);
      }

      discrepancies.push({
        field,
        assertionIds: assertionsList.map((a) => a.id),
        isBlocking,
      });
    }
  }

  return discrepancies;
}

/**
 * Returns the side-by-side reconciliation view for a dossier (§8):
 * Declarado | Extraído | Diferencia | Fuente | Confianza | Acción requerida
 */
export async function getFieldReconciliation(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<FieldReconciliationRow[]> {
  const activeAssertions = await getActiveAssertionsForDossier(organizationId, dossierId, txClient);
  const openDiscrepancies = await getOpenDiscrepancies(organizationId, dossierId, txClient);
  const discrepancyFieldMap = new Map<string, OpenDiscrepancy>(
    openDiscrepancies.map((d) => [d.field, d]),
  );

  // Group active assertions by field
  const byField = new Map<string, AssertionDetail[]>();
  for (const assertion of activeAssertions) {
    const list = byField.get(assertion.field) || [];
    list.push(assertion);
    byField.set(assertion.field, list);
  }

  const rows: FieldReconciliationRow[] = [];

  for (const [field, assertionsList] of byField.entries()) {
    // Look for declared and extracted assertions
    const declared = assertionsList.find((a) => a.origin === 'declared') || null;
    const extracted = assertionsList.find((a) => a.origin === 'extracted') || null;

    const discrepancy = discrepancyFieldMap.get(field);
    const isDiscrepancy = Boolean(discrepancy);
    const isBlocking = discrepancy ? discrepancy.isBlocking : false;

    rows.push({
      field,
      declaredValue: declared ? declared.value : null,
      declaredAssertionId: declared ? declared.id : null,
      extractedValue: extracted ? extracted.value : null,
      extractedAssertionId: extracted ? extracted.id : null,
      extractedSource: extracted ? extracted.evidenceId : null,
      extractedConfidence: extracted ? extracted.confidence : null,
      extractedStatus: extracted ? (extracted.status as 'pending_validation' | 'active' | 'discarded') : null,
      status: isDiscrepancy ? 'discrepancia' : 'concordante',
      requiredAction: isDiscrepancy ? 'Resolver discrepancia' : 'Ninguna',
      isBlocking,
    });
  }

  return rows;
}
