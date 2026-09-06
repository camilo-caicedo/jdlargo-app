# jdlargo-app — Next.js Fullstack Monolith

> **Fuente de verdad transversal:** [AGENTS.md](../AGENTS.md).
> Toda la definición funcional, épicas y decisiones de diseño viven en ../jdlargo-specs/.

## Reglas locales de desarrollo

1. **Idioma:** Código, comentarios, identificadores, tipos y nombres de archivo en inglés. Texto de cara al usuario (UI, validaciones, correos) en español. Identificadores de historia/requisito (HU-xxx, RF-xxx) invariables en español.
2. **Arquitectura:** Monolito Next.js según jdlargo-specs/08-desarrollo/arquitectura-de-aplicacion.md. Módulos de dominio bajo src/server/<module>/.
3. **Acceso a base de datos:** Solo vía src/server/db/client.ts (pooler) o src/server/db/admin-client.ts (directo/admin).
4. **Server Actions:** Capa delgada de orquestación (máximo 20 líneas). No contienen lógica de negocio directa; delegan a funciones de dominio en src/server/.
5. **Metodología:** TDD con Superpowers (superpowers@claude-plugins-official).
6. **Diseño visual:** toda pantalla sigue [`DESIGN.md`](./DESIGN.md) — tono, tipografía,
   color, componentes a emular y la lista de qué evitar para no verse "generado con AI".
   No reemplaza ninguna decisión de `ADR-0001` (librerías, RLS, límites de Server Action).
