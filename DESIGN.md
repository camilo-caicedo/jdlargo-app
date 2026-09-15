# Design system — jdlargo-app

Binding visual direction for every screen built in this repo. Origin: we tried generating
reference mockups in Canva AI (2026-09-06) and dropped it — quality wasn't good enough.
Antigravity builds UI directly in code against this brief instead of against a mockup.

No new dependency is authorized by this document. Charts stay `recharts`, the relationship
graph stays `react-flow`, components stay `shadcn/ui` on Tailwind — all already decided in
`ADR-0001`. "Emulate the visual language of X" below means *look like it*, not *install it*.

## Tone

Professional B2B compliance SaaS for compliance officers. Trustworthy, precise,
enterprise-grade. Not a flashy consumer product, not a generic AI-generated look.

## Visual language to emulate

Look and interaction patterns of **shadcn/ui**, **Tremor** (dashboard/chart layout, not the
package), **Untitled UI**, **Linear**, and Vercel's **Geist** design system:

- Data tables: sortable columns, row-selection checkboxes, pagination footer.
- Dashboard shell: sidebar + topbar, organization switcher, user menu.
- Filter bars with pill-style active filters.
- Status badges with subtle background tints, not solid fills.
- Toasts, tabs, command-palette-style search.

## Typography

Plus Jakarta Sans (primary font variable `--font-sans`). Tight negative letter-spacing on headings. Type scale:
12 / 14 / 16 / 20 / 24 / 32px. Generous body line-height. Monospace: Geist Mono.

## Color

Neutral base: zinc/slate grays. One primary accent: deep indigo or teal — never purple.
Semantic risk palette: emerald (low), amber (medium), rose (high). Light and dark theme,
both required from the start (shadcn/ui + `next-themes` default pattern).

## Layout

8px spacing grid. Generous whitespace. Flat cards, hairline 1px low-contrast borders —
not heavy drop shadows. Border radius 6–8px, not "everything is a pill." Icons:
`lucide-react`, thin stroke, no filled cartoon icons.

### Contenedores de página (web-first)

Páginas internas con contenido principal (`/app/[slug]/expedientes`, `/app/[slug]/miembros`, etc.) usan `max-w-full mx-auto` en el contenedor raíz para aprovechar el ancho disponible en desktop (≥1440px) sin restricción de ancho máximo. Los componentes internos (formularios, grillas, tarjetas) tienen sus propias restricciones locales según su necesidad (16-24 columnas, grids responsivos). Esta convención favorece la orientación web-first: el layout se expande a desktop, luego contrae para móvil (~390px) mediante media queries y grid responsivos, no mediante shrink de contenedor exterior.

## Explicitly avoid — the generic-AI tells

Purple-to-pink gradient blobs, glassmorphism, generic robot/shield/lock stock icons,
floating cards with heavy blur shadows, oversized rounded-everything corners,
center-aligned marketing-style hero text on app screens, clip-art illustrations, emoji in
UI copy, browser/laptop mockup frames around real screens.

## Where each rule of `ADR-0001`/`arquitectura-de-aplicacion.md` still governs

This document is visual only. It does not change: RLS/multi-tenant rules, the
`src/server/` module boundary, Server Action scope, or any data contract. A screen that
looks right but reads `organization_id` without the propagated user context is still wrong.

## Portal de la contraparte

Superficie pública y de una sola tarea (HU-010, HU-011, HU-012, HU-013). Se accede desde
enlaces de invitación (casi siempre desde dispositivos móviles), sin usuario autenticado en
Supabase Auth.

- **Layout:** una sola tarjeta centrada (max-w ~440px), fondo neutro, sin barra lateral,
  sin navegación ni migas de pan que sugieran "estás dentro de una aplicación". Sensación de
  página de verificación segura de un solo propósito.
- **Interacción y accesibilidad:** botones primarios con relleno sólido (nunca texto plano
  haciendo de botón). Estados `disabled` visibles con `cursor-not-allowed` y opacidad reducida.
  Anillo de foco visible en inputs y botones. Efectos hover sobrios en todos los elementos clickeables.
- **Estados de carga:** `loading.tsx` presenta un `Skeleton` de la tarjeta completa (no un
  spinner genérico flotante). Botones de acción deshabilitados con estado de carga mientras corre el
  Server Action para evitar doble envío.
- **Mensajes de error:** específicos y orientados a la acción. Si un enlace está expirado,
  revocado o es inválido, muestra el nombre y correo del responsable interno asignado al expediente
  para que la contraparte sepa a quién contactar — nunca errores técnicos crudos.
- **Temas:** compatibilidad con tema claro y oscuro desde el día uno con los mismos tokens zinc/slate.

## Login y selección de organización

Superficie de acceso para usuarios internos (analistas, oficiales de cumplimiento, administradores) (HU-055).
Comparte la misma familia visual que el Portal de la contraparte (tarjeta única, centrada, sin chrome ni navegación de app completa alrededor).

- **Layout:** tarjeta única y sobria, centrada horizontal y verticalmente en el viewport (`min-h-screen`, `max-w-md`), con borde sutil y fondo neutral.
- **Formulario de login (`/login`):**
  - Dos campos estándar (`Email` y `Contraseña`) con `Label` accesible y validación de cliente.
  - Botón primario de envío completo ("Iniciar sesión") con feedback de carga instantáneo (`useActionState` de React 19) para prevenir dobles envíos.
  - Errores de credenciales inválidas presentados en una alerta destructiva sobria con mensaje genérico de seguridad ("Correo o contraseña incorrectos.").
- **Selector de organización (`/login/organizacion`):**
  - Lista vertical de organizaciones a las que pertenece el usuario.
  - Cada organización se representa en una tarjeta clickeable (`Card` interactiva con hover suave y chevron) que actúa como botón de selección directa.
  - `loading.tsx` presenta un esqueleto con `Skeleton` de 2-3 tarjetas para evitar saltos visuales durante la resolución de membresías.
  - Si el usuario no cuenta con membresías activas, mensaje explicativo y botón para volver a iniciar sesión o contactar al administrador.
- **Shell autenticado mínimo (`/app/[organizationId]`):**
  - Encabezado superior austero de una sola línea (borde inferior 1px, fondo de superficie):
    - Identificador y nombre de la organización activa a la izquierda.
    - Botón secundario o de enlace sutil "Cerrar sesión" alineado a la derecha.
  - Sin sidebar, buscador ni menús complejos hasta la especificación de la historia del Shell general del producto.

## Página de inicio pública

Superficie pública de bienvenida y presentación del producto (HU-058).
Es la única página donde un *hero* centrado con jerarquía tipográfica amplia y llamada a la acción es deliberadamente correcto (la prohibición general de *marketing hero* de este documento aplica exclusivamente a las pantallas internas de la aplicación).

- **Fondo y ambientación:** degradado radial sutil en el borde superior (`radial-gradient` con opacidad del 8% de `--primary`), sin formas poligonales complejas ni blobs genéricos. `min-h-dvh` para evitar saltos en viewport móvil.
- **Header:** barra superior con efecto translúcido (`backdrop-blur-md`), isotipo/marca sobrio "JD Largo" a la izquierda y botón de acceso directo "Iniciar sesión" a la derecha (`/login`) con área táctil cómoda (mínimo 44px de alto en móvil).
- **Hero:**
  - Título con posicionamiento oficial: "Automatización de Debida Diligencia" con degradado tipográfico sutil en escala de grises.
  - Párrafo de valor validado: recolección, extracción, verificación, evaluación y registro, recordando explícitamente que la decisión y la responsabilidad pertenecen al cliente.
  - Botón primario de acceso ("Acceder a la plataforma") con sombra sobria y efecto de elevación en hover.
  - Fila de 4 pilares de valor clave con íconos de verificación (`CheckCircle2`).
- **Ciclo de vinculación:** cuadrícula de 3 tarjetas (`Card`) con elevación suave en hover (`hover:-translate-y-0.5 hover:shadow-md`) y transición sobre propiedades específicas (`transform`, `box-shadow`, `border-color`), respetando `prefers-reduced-motion`. Describe estrictamente las capacidades vigentes del producto:
  - *Acceso Seguro por Enlace* (tokens criptográficos de un solo uso y 2FA).
  - *Matriz de Requisitos por Estándar* (versiones inmutables por organización).
  - *Trazabilidad Total* (bitácora y reconstrucción de auditoría).
- **Footer:** pie de página austero de una sola fila con copyright, correo de soporte de texto plano y enlace discreto de acceso interno. Sin enlaces rotos a páginas inexistentes.
- **Regla inquebrantable (`ADR-0006`):** cero uso de las palabras "certifica", "certificado" o "certificación" atribuidas al software o a los resultados.




