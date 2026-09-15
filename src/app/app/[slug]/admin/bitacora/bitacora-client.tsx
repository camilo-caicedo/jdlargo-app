"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  History,
  Filter,
  RefreshCw,
  Search,
  Bot,
  User,
  Cpu,
  ChevronRight,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { fetchAuditLogsAction, getEntityAuditHistoryAction } from "./actions";

interface AuditEntry {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorUserName?: string | null;
  actorUserEmail?: string | null;
  actorType: "user" | "system" | "counterparty";
  action: string;
  entity: string | null;
  entityId: string | null;
  occurredAt: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  automatic: boolean;
  eventHash: string;
}

export function BitacoraClient({
  organizationId,
  initialEntries,
  initialNextCursor,
}: {
  organizationId: string;
  initialEntries: AuditEntry[];
  initialNextCursor: string | null;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  // History modal for specific entity
  const [selectedEntityHistory, setSelectedEntityHistory] = useState<{
    entity: string;
    entityId: string;
    items: AuditEntry[];
  } | null>(null);

  // Selected row for detail inspector
  const [inspectedEntry, setInspectedEntry] = useState<AuditEntry | null>(null);

  async function handleApplyFilters(resetPagination = true) {
    setLoading(true);

    const res = await fetchAuditLogsAction(organizationId, {
      action: actionFilter.trim() || undefined,
      entity: entityFilter.trim() || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
      limit: 50,
      cursor: resetPagination ? undefined : nextCursor || undefined,
    });

    setLoading(false);

    if (res.error) {
      toast.error(res.error);
    } else if (res.entries) {
      if (resetPagination) {
        setEntries(res.entries as unknown as AuditEntry[]);
      } else {
        setEntries((prev) => [...prev, ...(res.entries as unknown as AuditEntry[])]);
      }
      setNextCursor(res.nextCursor || null);
    }
  }

  async function handleInspectEntityHistory(entity: string, entityId: string) {
    const res = await getEntityAuditHistoryAction(organizationId, entity, entityId);
    if (res.history) {
      setSelectedEntityHistory({
        entity,
        entityId,
        items: res.history as unknown as AuditEntry[],
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters Card */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-500" />
            Filtros de consulta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Acción</Label>
              <Input
                placeholder="ej. configuration.published"
                className="h-8 text-xs"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Entidad</Label>
              <Input
                placeholder="ej. counterparty, configuration"
                className="h-8 text-xs"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActionFilter("");
                setEntityFilter("");
                setFromFilter("");
                setToFilter("");
              }}
            >
              Limpiar
            </Button>
            <Button size="sm" onClick={() => handleApplyFilters(true)} disabled={loading}>
              <Search className="h-3.5 w-3.5 mr-1" />
              Filtrar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Table */}
      <Card>
        <CardHeader className="py-4 flex flex-row items-center justify-between border-b">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-zinc-500" />
              Eventos Registrados
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Trazabilidad inmutable protegida por resumen criptográfico SHA-256.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleApplyFilters(true)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50 text-zinc-500 font-medium">
              <tr>
                <th className="py-3 px-4 w-[180px]">Fecha / Hora</th>
                <th className="py-3 px-4">Acción</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Entidad</th>
                <th className="py-3 px-4">Motivo / Razón</th>
                <th className="py-3 px-4 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 px-4 text-center py-8 text-zinc-500 text-sm">
                    No se encontraron eventos en la bitácora con los criterios seleccionados.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                    <td className="py-3 px-4 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                      {new Date(entry.occurredAt).toLocaleString("es-CO")}
                    </td>
                    <td className="py-3 px-4">
                      <code className="text-xs font-semibold px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                        {entry.action}
                      </code>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-xs">
                        {entry.actorType === "system" ? (
                          <>
                            <Cpu className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-blue-600 dark:text-blue-400 font-medium">Sistema</span>
                          </>
                        ) : entry.automatic ? (
                          <>
                            <Bot className="h-3.5 w-3.5 text-purple-500" />
                            <span className="text-purple-600 dark:text-purple-400 font-medium">IA / Auto</span>
                          </>
                        ) : (
                          <>
                            <User className="h-3.5 w-3.5 text-zinc-500" />
                            <span
                              className="text-zinc-700 dark:text-zinc-300 font-medium truncate max-w-[150px]"
                              title={entry.actorUserEmail ? `${entry.actorUserName || "Usuario"} (${entry.actorUserEmail})` : (entry.actorUserName || "Usuario")}
                            >
                              {entry.actorUserName || entry.actorUserEmail || "Usuario"}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {entry.entity && entry.entityId ? (
                        <button
                          onClick={() => handleInspectEntityHistory(entry.entity!, entry.entityId!)}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-mono"
                          title="Ver historial de esta fila"
                        >
                          {entry.entity}
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 max-w-[200px] truncate">
                      {entry.reason || <span className="text-zinc-300 italic">Sin motivo explícito</span>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 px-2"
                        onClick={() => setInspectedEntry(entry)}
                      >
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table></div>

          {nextCursor && (
            <div className="p-4 border-t flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleApplyFilters(false)}
                disabled={loading}
              >
                Cargar más registros
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row inspector drawer / modal */}
      {inspectedEntry && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-950">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Detalle del Evento de Bitácora
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  ID: {inspectedEntry.id}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setInspectedEntry(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-2 gap-2 pb-3 border-b">
                <div>
                  <span className="text-zinc-500 font-medium">Acción:</span>{" "}
                  <code className="font-mono font-semibold">{inspectedEntry.action}</code>
                </div>
                <div>
                  <span className="text-zinc-500 font-medium">Fecha:</span>{" "}
                  {new Date(inspectedEntry.occurredAt).toLocaleString("es-CO")}
                </div>
                <div>
                  <span className="text-zinc-500 font-medium">Actor:</span>{" "}
                  {inspectedEntry.actorType === "system" ? (
                    <span className="text-blue-600 dark:text-blue-400 font-medium">Sistema</span>
                  ) : inspectedEntry.automatic ? (
                    <span className="text-purple-600 dark:text-purple-400 font-medium">IA / Automático</span>
                  ) : (
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {inspectedEntry.actorUserName || inspectedEntry.actorUserEmail || "Usuario"}
                      {inspectedEntry.actorUserEmail && inspectedEntry.actorUserName ? (
                        <span className="text-zinc-500 font-normal ml-1">({inspectedEntry.actorUserEmail})</span>
                      ) : null}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-zinc-500 font-medium">Hash Criptográfico:</span>{" "}
                  <span className="font-mono text-[10px] break-all">{inspectedEntry.eventHash}</span>
                </div>
              </div>

              {inspectedEntry.reason && (
                <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded border">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Motivo / Justificación obligatoria:
                  </span>
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">{inspectedEntry.reason}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="font-semibold text-zinc-500">Valor Anterior (Prev)</span>
                  <pre className="p-2 bg-zinc-100 dark:bg-zinc-900 rounded text-[11px] overflow-x-auto max-h-48">
                    {inspectedEntry.previousValue !== null && inspectedEntry.previousValue !== undefined
                      ? JSON.stringify(inspectedEntry.previousValue, null, 2)
                      : "null"}
                  </pre>
                </div>
                <div className="space-y-1">
                  <span className="font-semibold text-zinc-500">Nuevo Valor (Next)</span>
                  <pre className="p-2 bg-zinc-100 dark:bg-zinc-900 rounded text-[11px] overflow-x-auto max-h-48">
                    {inspectedEntry.newValue !== null && inspectedEntry.newValue !== undefined
                      ? JSON.stringify(inspectedEntry.newValue, null, 2)
                      : "null"}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Entity History Modal */}
      {selectedEntityHistory && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-950">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <History className="h-4 w-4 text-zinc-500" />
                  Historial de Cambios: {selectedEntityHistory.entity}
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  ID de Fila: {selectedEntityHistory.entityId}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedEntityHistory(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <p className="text-xs text-zinc-500">
                Secuencia cronológica completa e ininterrumpida de todos los cambios aplicados a esta fila.
              </p>

              <div className="relative border-l-2 border-zinc-200 dark:border-zinc-800 ml-3 space-y-6">
                {selectedEntityHistory.items.map((item) => (
                  <div key={item.id} className="relative pl-6">
                    <div className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-white dark:border-zinc-950 bg-zinc-400" />
                    <div className="p-3 rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <code className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {item.action}
                          </code>
                          <span className="text-[11px] text-zinc-500 font-medium">
                            • {item.actorType === "system" ? (
                              "Sistema"
                            ) : item.automatic ? (
                              "IA / Auto"
                            ) : (
                              item.actorUserName || item.actorUserEmail || "Usuario"
                            )}
                          </span>
                        </div>
                        <span className="text-zinc-500 font-mono">
                          {new Date(item.occurredAt).toLocaleString("es-CO")}
                        </span>
                      </div>
                      {item.reason && (
                        <div className="text-zinc-600 dark:text-zinc-400 italic">
                          &ldquo;{item.reason}&rdquo;
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
                        <div>
                          <span className="text-zinc-400">Antes:</span>{" "}
                          <span className="truncate block">
                            {JSON.stringify(item.previousValue) || "null"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Después:</span>{" "}
                          <span className="truncate block">
                            {JSON.stringify(item.newValue) || "null"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
