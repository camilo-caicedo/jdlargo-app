"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Plus, AlertCircle, Layers, FileText, CheckCircle2 } from "lucide-react";
import { addCounterpartyTypeAction, addRequirementAction } from "./actions";
import { createDraftFromRolesAction } from "../roles/actions";
import { getDocumentTypeOptions, isDocumentTypeSupported } from "@/lib/document-type-catalog";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

interface RequirementItem {
  requirementId: string;
  standard: string;
  type: "field" | "document_type";
  key: string;
  mandatory: "always" | "conditional" | "optional";
  blocking: boolean;
}

interface CounterpartyTypeWithReqs {
  id: string;
  name: string;
  nature: string;
  requirements: RequirementItem[];
}

export function MatrizRequisitosClient({
  organizationId,
  slug,
  versionId,
  versionNumber,
  standard,
  isDraft,
  typesWithRequirements,
  canAdminister,
}: {
  organizationId: string;
  slug: string;
  versionId: string | null;
  versionNumber: string;
  standard: string;
  isDraft: boolean;
  typesWithRequirements: CounterpartyTypeWithReqs[];
  canAdminister: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // New counterparty type form
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeNature, setNewTypeNature] = useState<"natural_person" | "legal_entity">("legal_entity");

  // New requirement form state
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [reqType, setReqType] = useState<"field" | "document_type">("field");
  const [reqKey, setReqKey] = useState("");
  const [reqMandatory, setReqMandatory] = useState<"always" | "conditional" | "optional">("always");
  const [reqBlocking, setReqBlocking] = useState(true);
  const [documentTypeWarning, setDocumentTypeWarning] = useState<string | null>(null);

  // Combobox state for document types
  const CUSTOM_DOC_TYPE = "__custom__";
  const documentTypeOptions = getDocumentTypeOptions();
  const documentTypeItems = [...documentTypeOptions, { value: CUSTOM_DOC_TYPE, label: "Otro (personalizado)", description: "Define un tipo de documento no en el catálogo" }];
  const selectedDocType = documentTypeOptions.find((d) => d.value === reqKey) || (reqKey === CUSTOM_DOC_TYPE ? documentTypeItems[documentTypeItems.length - 1] : null);
  const isCustomDocType = reqKey === CUSTOM_DOC_TYPE || (reqKey && !isDocumentTypeSupported(reqKey));

  async function handleCreateDraft() {
    setIsPending(true);
    setError(null);
    const res = await createDraftFromRolesAction(organizationId, slug);
    setIsPending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess("Borrador creado exitosamente.");
      router.refresh();
    }
  }

  async function handleAddType(e: React.FormEvent) {
    e.preventDefault();
    if (!versionId) return;
    if (!newTypeName.trim()) {
      setError("El nombre del tipo de contraparte es obligatorio.");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    const res = await addCounterpartyTypeAction(slug, {
      organizationId,
      configurationVersionId: versionId,
      name: newTypeName.trim(),
      nature: newTypeNature,
    });

    setIsPending(false);

    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(`Tipo de contraparte "${newTypeName}" agregado.`);
      setNewTypeName("");
      setShowAddType(false);
      router.refresh();
    }
  }

  async function handleAddRequirement(e: React.FormEvent) {
    e.preventDefault();
    if (!versionId || !selectedTypeId) return;
    if (!reqKey.trim()) {
      setError("La clave del requisito es obligatoria.");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    const res = await addRequirementAction(slug, {
      organizationId,
      configurationVersionId: versionId,
      counterpartyTypeId: selectedTypeId,
      standard,
      type: reqType,
      key: reqKey.trim(),
      mandatory: reqMandatory,
      blocking: reqBlocking,
    });

    setIsPending(false);

    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(`Requisito "${reqKey}" agregado exitosamente.`);
      setReqKey("");
      setSelectedTypeId(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertTitle>Éxito</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Header card with status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg font-semibold">
                Matriz de Requisitos (Versión {versionNumber})
              </CardTitle>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isDraft ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"}`}>{isDraft ? "Borrador" : "Vigente (Solo lectura)"}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{standard.toUpperCase()}</span>
            </div>
            <CardDescription className="mt-1">
              {isDraft
                ? "Edición activa sobre el borrador actual. Los cambios se aplicarán cuando la versión sea publicada."
                : "La versión vigente está congelada. Para modificar requisitos o tipos, cree un nuevo borrador."}
            </CardDescription>
          </div>
          {!isDraft && canAdminister && (
            <Button onClick={handleCreateDraft} disabled={isPending}>
              Crear borrador para editar
            </Button>
          )}
        </CardHeader>
      </Card>

      {/* Counterparty Types Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Layers className="h-5 w-5 text-zinc-500" />
            Tipos de Contraparte y sus Requisitos
          </h3>

          {isDraft && canAdminister && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddType(!showAddType)}
              className="flex items-center gap-1 text-xs"
            >
              <Plus className="h-4 w-4" />
              Nuevo tipo de contraparte
            </Button>
          )}
        </div>

        {/* Form to add counterparty type */}
        {showAddType && isDraft && (
          <Card className="border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50">
            <CardContent className="pt-6">
              <form onSubmit={handleAddType} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="typeName">Nombre del tipo</Label>
                    <Input
                      id="typeName"
                      placeholder="Ej. Proveedor Crítico, Empleado, Accionista"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="typeNature">Naturaleza jurídica</Label>
                    <select
                      id="typeNature"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={newTypeNature}
                      onChange={(e) => setNewTypeNature(e.target.value as "natural_person" | "legal_entity")}
                    >
                      <option value="legal_entity">Persona Jurídica</option>
                      <option value="natural_person">Persona Natural</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddType(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={isPending}>
                    Guardar Tipo
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* List of Types */}
        {typesWithRequirements.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-zinc-500 text-sm">
              No hay tipos de contraparte registrados en esta versión.
              {isDraft && " Agregue el primero usando el botón superior."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {typesWithRequirements.map((t) => (
              <Card key={t.id} className="overflow-hidden">
                <CardHeader className="bg-zinc-50/50 dark:bg-zinc-900/50 py-3 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
                        {t.nature === "natural_person" ? "Persona Natural" : "Persona Jurídica"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        ({t.requirements.length} requisito{t.requirements.length === 1 ? "" : "s"})
                      </span>
                    </div>

                    {isDraft && canAdminister && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedTypeId(selectedTypeId === t.id ? null : t.id)}
                        className="text-xs flex items-center gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Agregar requisito
                      </Button>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-3">
                  {/* Add requirement form for this type */}
                  {selectedTypeId === t.id && isDraft && (
                    <form onSubmit={handleAddRequirement} className="p-4 mb-4 border rounded-md bg-zinc-50 dark:bg-zinc-900 space-y-4">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Nuevo requisito para {t.name}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Tipo</Label>
                          <select
                            className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                            value={reqType}
                            onChange={(e) => setReqType(e.target.value as "field" | "document_type")}
                          >
                            <option value="field">Campo de datos</option>
                            <option value="document_type">Tipo documental</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Clave / Identificador</Label>
                          {reqType === "document_type" ? (
                            <div className="space-y-1">
                              <Combobox
                                items={documentTypeItems}
                                value={selectedDocType}
                                onValueChange={(val) => {
                                  if (val) {
                                    if (val.value === CUSTOM_DOC_TYPE) {
                                      setReqKey(CUSTOM_DOC_TYPE);
                                      setDocumentTypeWarning(null);
                                    } else {
                                      setReqKey(val.value);
                                      if (!isDocumentTypeSupported(val.value)) {
                                        setDocumentTypeWarning("Este tipo no está en el catálogo de tipos soportados por IA y se procesará manualmente.");
                                      } else {
                                        setDocumentTypeWarning(null);
                                      }
                                    }
                                  }
                                }}
                                itemToStringLabel={(item) => item?.label ?? ""}
                                isItemEqualToValue={(a, b) => a?.value === b?.value}
                                disabled={isPending}
                              >
                                <ComboboxInput placeholder="Seleccionar tipo de documento..." />
                                <ComboboxContent>
                                  <ComboboxEmpty>No se encontraron tipos.</ComboboxEmpty>
                                  <ComboboxList>
                                    {(item: typeof documentTypeItems[0]) => (
                                      <ComboboxItem key={item.value} value={item}>
                                        <div className="flex flex-col gap-0.5">
                                          <span>{item.label}</span>
                                          {item.description && (
                                            <span className="text-xs text-muted-foreground">{item.description}</span>
                                          )}
                                        </div>
                                      </ComboboxItem>
                                    )}
                                  </ComboboxList>
                                </ComboboxContent>
                              </Combobox>
                              {isCustomDocType && (
                                <Input
                                  placeholder="ej. doc_licencia_conduccion, doc_certificado_bancario"
                                  className="h-8 text-xs mt-1"
                                  value={reqKey === CUSTOM_DOC_TYPE ? "" : reqKey}
                                  onChange={(e) => {
                                    const newKey = e.target.value;
                                    setReqKey(newKey);
                                    if (newKey && !isDocumentTypeSupported(newKey)) {
                                      setDocumentTypeWarning("Este tipo no está en el catálogo de tipos soportados por IA y se procesará manualmente.");
                                    } else {
                                      setDocumentTypeWarning(null);
                                    }
                                  }}
                                  required={isCustomDocType}
                                />
                              )}
                              {documentTypeWarning && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">{documentTypeWarning}</p>
                              )}
                            </div>
                          ) : (
                            <Input
                              placeholder="ej. rut, camara_comercio"
                              className="h-8 text-xs"
                              value={reqKey}
                              onChange={(e) => {
                                setReqKey(e.target.value);
                                setDocumentTypeWarning(null);
                              }}
                              required
                            />
                          )}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Obligatoriedad</Label>
                          <select
                            className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                            value={reqMandatory}
                            onChange={(e) => setReqMandatory(e.target.value as "always" | "conditional" | "optional")}
                          >
                            <option value="always">Siempre obligatorio</option>
                            <option value="optional">Opcional</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Bloqueante</Label>
                          <div className="flex items-center h-8 gap-2">
                            <input
                              type="checkbox"
                              id="reqBlocking"
                              checked={reqBlocking}
                              onChange={(e) => setReqBlocking(e.target.checked)}
                              className="rounded border-zinc-300"
                            />
                            <Label htmlFor="reqBlocking" className="text-xs font-normal cursor-pointer">
                              Bloquea debida diligencia
                            </Label>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedTypeId(null)}>
                          Cancelar
                        </Button>
                        <Button type="submit" size="sm" disabled={isPending}>
                          Guardar Requisito
                        </Button>
                      </div>
                    </form>
                  )}

                  {/* Requirements List */}
                  {t.requirements.length === 0 ? (
                    <div className="text-xs text-amber-600 dark:text-amber-400 py-2">
                      ⚠️ Este tipo no tiene requisitos definidos. (La versión no podrá ser publicada hasta que tenga al menos un requisito).
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {t.requirements.map((req) => (
                        <div key={req.requirementId} className="py-2 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-zinc-400" />
                            <code className="font-mono text-xs px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                              {req.key}
                            </code>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-mono border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
                              {req.type === "field" ? "Campo" : "Documento"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${req.mandatory === "always" ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 font-medium" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                              {req.mandatory === "always" ? "Obligatorio" : req.mandatory}
                            </span>
                            {req.blocking && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800">
                                Bloqueante
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
