import Link from "next/link";
import {
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
    <div className="relative min-h-dvh bg-background text-foreground flex flex-col selection:bg-primary selection:text-primary-foreground">
      {/* Subtle radial ambient background with deep indigo primary accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent)]"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
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
              className={cn(
                buttonVariants({ variant: "default", size: "default" }),
                "min-h-[44px] sm:min-h-0 font-medium gap-1.5 shadow-sm"
              )}
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
        <section className="relative pt-16 pb-20 sm:pt-24 sm:pb-24 px-4 sm:px-6 text-center max-w-5xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/80 bg-muted/60 text-xs font-medium text-muted-foreground mb-6 shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
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
                "w-full sm:w-auto min-h-[44px] text-base font-semibold px-6 h-11 gap-2 shadow-md hover:shadow-lg transition-shadow"
              )}
            >
              Acceder a la plataforma
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Value Highlights Pill Row (Staggered subtle entrance) */}
          <div className="mt-14 pt-8 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-4 text-left">
            <div className="flex items-start gap-2.5 p-2 transition-opacity duration-300">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Expediente Reconstruible</p>
                <p className="text-xs text-muted-foreground mt-0.5">Evidencia inmutable con procedencia</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2 transition-opacity duration-300">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Portal Seguro para Contrapartes</p>
                <p className="text-xs text-muted-foreground mt-0.5">Acceso por token único y segundo factor</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2 transition-opacity duration-300">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Aislamiento por Organización</p>
                <p className="text-xs text-muted-foreground mt-0.5">Seguridad RLS estricta por tenant</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2 transition-opacity duration-300">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Bitácora Integral de Auditoría</p>
                <p className="text-xs text-muted-foreground mt-0.5">Rastro inmutable de cada acción</p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid Section */}
        <section className="py-12 sm:py-20 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border/40">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Todo el ciclo de vinculación en un solo lugar
            </h2>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground">
              Diseñado específicamente para las exigencias de supervisión en Colombia.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border border-border/80 bg-card hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-md transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transform-none">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <FileSearch className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Acceso Seguro por Enlace
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Emisión controlada de enlaces temporales de acceso para contrapartes,
                  con token criptográfico de un solo uso y verificación por segundo factor opcional.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border/80 bg-card hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-md transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transform-none">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <Sliders className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Matriz de Requisitos por Estándar
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Requisitos diferenciados por marco regulatorio (SARLAFT, SAGRILAFT, PTEE)
                  vinculados a versiones inmutables de configuración por organización.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-border/80 bg-card hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-md transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transform-none">
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