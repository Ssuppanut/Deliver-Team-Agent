/** Svelte token map — CSS custom properties (web). */
export const mapToken = (name) => `var(--${name.replace(/\./g, '-')})`;
export const STYLE_PROP = {
  background: 'background-color',
  color: 'color',
  padding: 'padding',
  radius: 'border-radius',
  gap: 'gap',
  border: 'border-color',
  font: 'font-family',
  fontSize: 'font-size',
};
