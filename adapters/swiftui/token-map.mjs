/** SwiftUI token map — DesignTokens.swift static members (PascalCase). */
const pascal = (s) => s.replace(/(^|[.\-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());
export const mapToken = (name) => `DesignTokens.${pascal(name)}`;

/** style slot -> SwiftUI view modifier factory. */
export const MODIFIER = {
  background: (t) => `.background(${t})`,
  color: (t) => `.foregroundColor(${t})`,
  padding: (t) => `.padding(${t})`,
  radius: (t) => `.cornerRadius(${t})`,
};
