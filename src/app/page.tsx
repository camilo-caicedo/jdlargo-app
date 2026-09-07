import Link from "next/link";
import {
  ShieldCheck,
  FileSearch,
  History,
  ArrowRight,
  Sparkles,
  Sliders,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col selection:bg-primary selection:text-primary-foreground">
      {/* Background glow effects */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 transform-gpu overflow-hidden blur-3xl"
      >
        <div
          style={{
            clipPath:
              "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
          }}
          className="relative left-[calc(50%-18rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-primary/20 to-accent/30 opacity-40 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md transition-all">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-sm">
              JD
            </div>
            <span className="font-semibold text-base tracking-tight">
              JD Largo
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "font-medium gap-1.5 shadow-sm")}
            >
              Iniciar sesión
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-16 pb-20 sm:pt-24 sm:pb-28 px-4 sm:px-6 text-center max-w-5xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/80 bg-muted/60 text-xs font-medium text-muted-foreground mb-6 shadow-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>SARLAFT • SAGRILAFT • PTEE</span>
          </div>

          {/* Heading */}
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground text-balance max-w-4xl mx-auto leading-[1.12]">
            Automatización de{" "}
            <span className="bg-gradient-to-r from-foreground via-foreground/80 to-foreground/50 bg-clip-text text-transparent">
              Debida Diligencia
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-6 text-base sm:text-xl text-muted-foreground text-balance max-w-2xl mx-auto font-normal leading-relaxed">
            Automatizamos y trazamos el proceso de debida diligencia de contrapartes.
            La plataforma recolecta, extrae, verifica, evalúa y deja registro;
            la decisión y la responsabilidad son siempre de su equipo de cumplimiento.
          </p>

          {/* Actions */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "w-full sm:w-auto text-base font-semibold px-6 h-11 gap-2 shadow-md hover:shadow-lg transition-all"
              )}
            >
              Acceder a la plataforma
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Value Highlights Pill Row */}
          <div className="mt-12 pt-8 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-4 text-left">
            <div className="flex items-start gap-2.5 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Expediente Reconstruible</p>
                <p className="text-xs text-muted-foreground mt-0.5">Evidencia inmutable con procedencia</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Portal Seguro para Contrapartes</p>
                <p className="text-xs text-muted-foreground mt-0.5">Acceso por token único y segundo factor</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Aislamiento por Organización</p>
                <p className="text-xs text-muted-foreground mt-0.5">Seguridad RLS estricta por tenant</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Bitácora Integral de Auditoría</p>
                <p className="text-xs text-muted-foreground mt-0.5">Rastro inmutable de cada acción</p>
              </div>
            </div>
          </div>
        </section>

        {/* Interactive App Preview Showcase */}
        <section className="py-12 sm:py-16 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="relative rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xs">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-xs font-mono text-muted-foreground">
                  app.jdlargo.com/app/expedientes
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                Oficial de Cumplimiento
              </span>
            </div>

            {/* Mock Dashboard UI Layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Requisitos & Expediente */}
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Expediente #EXP-2026-0814
                    </span>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      En revisión
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">
                    Transportes Andinos del Norte S.A.S.
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    NIT 900.452.881-2 • Régimen SARLAFT Transporte
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/50 text-xs flex justify-between items-center text-muted-foreground">
                  <span>Requisitos completados</span>
                  <span className="font-semibold text-foreground">8 de 9</span>
                </div>
              </div>

              {/* Card 2: Listas Restrictivas & Consultas */}
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Screening de Listas
                    </span>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Sin coincidencias
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">
                    Verificación de Contraparte y Beneficiarios
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    OFAC, ONU, PEP Colombia, Contraloría y Procuraduría
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/50 text-xs flex justify-between items-center text-muted-foreground">
                  <span>Última consulta</span>
                  <span className="font-mono text-[11px]">Hoy, 14:32</span>
                </div>
              </div>

              {/* Card 3: Dictamen & Trazabilidad */}
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Sugerencia del Sistema
                    </span>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary">
                      Riesgo Bajo
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">
                    Evidencia Congelada
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Versión de configuración normativa fijada: v2.1.0
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/50 text-xs flex justify-between items-center text-muted-foreground">
                  <span>Responsable</span>
                  <span className="font-medium text-foreground">Camila Salazar</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid Section */}
        <section className="py-16 sm:py-24 px-4 sm:px-6 max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Todo el ciclo de vinculación en un solo lugar
            </h2>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground">
              Diseñado específicamente para las exigencias de supervisión en Colombia.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border border-border/80 bg-card hover:border-primary/50 transition-all">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <FileSearch className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Recolección Asistida
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Envíe formularios seguros y enlaces de debida diligencia directamente a sus
                  contrapartes para carga autónoma de datos y documentación.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border/80 bg-card hover:border-primary/50 transition-all">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <Sliders className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Estándares Configurables
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Active requisitos diferenciados por estándar regulatorio (SARLAFT, SAGRILAFT, PTEE)
                  según las características y el marco de su organización.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border/80 bg-card hover:border-primary/50 transition-all">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <History className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Trazabilidad Total
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Reconstruya paso a paso qué información se evaluó, bajo qué versión de reglas y
                  quién autorizó la vinculación ante cualquier auditoría o requerimiento.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-muted/20 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">JD Largo</span>
            <span>•</span>
            <span>© {new Date().getFullYear()} Todos los derechos reservados.</span>
          </div>

          <div className="flex items-center gap-6">
            <span>Soporte: soporte@jdlargo.com</span>
            <Link
              href="/login"
              className="hover:text-foreground transition-colors font-medium inline-flex items-center gap-1"
            >
              Acceso interno
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}