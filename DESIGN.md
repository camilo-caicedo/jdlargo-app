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

Geist Sans or Inter. Tight negative letter-spacing on headings. Type scale:
12 / 14 / 16 / 20 / 24 / 32px. Generous body line-height.

## Color

Neutral base: zinc/slate grays. One primary accent: deep indigo or teal — never purple.
Semantic risk palette: emerald (low), amber (medium), rose (high). Light and dark theme,
both required from the start (shadcn/ui + `next-themes` default pattern).

## Layout

8px spacing grid. Generous whitespace. Flat cards, hairline 1px low-contrast borders —
not heavy drop shadows. Border radius 6–8px, not "everything is a pill." Icons:
`lucide-react`, thin stroke, no filled cartoon icons.

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

