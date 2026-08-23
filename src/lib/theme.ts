export const ACCENT_PRESETS = [
  { label: "Teal", hue: 168 },
  { label: "Azul", hue: 240 },
  { label: "Roxo", hue: 300 },
  { label: "Rosa", hue: 350 },
  { label: "Laranja", hue: 50 },
] as const;

const PRIMARY_VARS = [
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--chart-1",
] as const;

/**
 * Applies theme (dark/light) and accent hue as inline CSS custom properties
 * on <html>. Both fall back to the app's original look when unset — dark
 * theme, teal accent — so anyone who never opens these settings sees no
 * change at all. Inline styles win over the .light class's own values by
 * CSS specificity, so this is safe to call regardless of theme.
 */
export function applyTheme(theme?: string | null, accentHue?: number | null): void {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");

  if (accentHue == null) {
    for (const name of PRIMARY_VARS) root.style.removeProperty(name);
    root.style.removeProperty("--primary-foreground");
    return;
  }

  const isLight = theme === "light";
  const primaryL = isLight ? 0.55 : 0.75;
  const primaryFgL = isLight ? 0.98 : 0.18;
  const value = `oklch(${primaryL} 0.15 ${accentHue})`;
  for (const name of PRIMARY_VARS) root.style.setProperty(name, value);
  root.style.setProperty("--primary-foreground", `oklch(${primaryFgL} 0.03 ${accentHue})`);
}