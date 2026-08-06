import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// pt-BR's Intl formatters render month/weekday names lowercase ("agosto",
// "ago."), which is grammatically correct Portuguese but reads as less
// polished for a UI. This only touches locale-generated strings — never
// text the user typed themselves (deck names, card content, labels).
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}