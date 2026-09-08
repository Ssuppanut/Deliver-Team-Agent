/** Jetpack Compose token map — DesignTokens.kt vals (PascalCase). */
const pascal = (s) => s.replace(/(^|[.\-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());
export const mapToken = (name) => `DesignTokens.${pascal(name)}`;
