/**
 * React token map.
 * Semantic tokens resolve to CSS custom properties emitted by tokens-dtcg
 * (tokens.css). Style slots map to React inline-style CSS properties.
 */
export const mapToken = (name) => `var(--${name.replace(/\./g, '-')})`;

export const STYLE_PROP = {
  background: 'backgroundColor',
  color: 'color',
  padding: 'padding',
  radius: 'borderRadius',
  gap: 'gap',
  border: 'borderColor',
  font: 'fontFamily',
  fontSize: 'fontSize',
};
