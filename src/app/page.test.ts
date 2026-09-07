import { describe, it, expect } from "vitest";
import fs from "fs";

describe("HU-058: Validaciones estáticas de la página de inicio", () => {
  const pageContent = fs.readFileSync("src/app/page.tsx", "utf-8");
  const layoutContent = fs.readFileSync("src/app/layout.tsx", "utf-8");

  it("Cumple ADR-0006: nunca usa términos de certificación aplicados al producto", () => {
    const forbiddenMatches = pageContent.match(/certific[a-z]*/gi) || [];
    expect(forbiddenMatches).toEqual([]);
  });

  it("Layout raíz está configurado en español", () => {
    expect(layoutContent).toContain('lang="es"');
  });

  it("Enlaza directamente al inicio de sesión (/login)", () => {
    expect(pageContent).toContain('href="/login"');
  });

  it("Contiene el título de posicionamiento aprobado en vision.md", () => {
    expect(pageContent).toContain("Automatización de");
    expect(pageContent).toContain("Debida Diligencia");
  });
});