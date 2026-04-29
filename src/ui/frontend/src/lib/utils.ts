import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}

// Flag type colors — hex for inline styles, Tailwind classes for components
export const FLAG_TYPE_COLORS: Record<string, { hex: string; bg: string; text: string }> = {
  decision:     { hex: "#4a9eff", bg: "bg-[#1a2a3a]", text: "text-[#4a9eff]" },
  assumption:   { hex: "#f08030", bg: "bg-[#2a1a0f]", text: "text-[#f08030]" },
  architecture: { hex: "#3dd68c", bg: "bg-[#1a2a1a]", text: "text-[#3dd68c]" },
  pattern:      { hex: "#a070e8", bg: "bg-[#2a1a2a]", text: "text-[#a070e8]" },
  dependency:   { hex: "#40b0f0", bg: "bg-[#0f1a2a]", text: "text-[#40b0f0]" },
  tradeoff:     { hex: "#f0c040", bg: "bg-[#2a2a0f]", text: "text-[#f0c040]" },
  constraint:   { hex: "#f05060", bg: "bg-[#2a1010]", text: "text-[#f05060]" },
  workaround:   { hex: "#d0a030", bg: "bg-[#1a1a0f]", text: "text-[#d0a030]" },
  risk:         { hex: "#f06070", bg: "bg-[#2a1010]", text: "text-[#f06070]" },
};

export function getFlagColors(type: string) {
  return FLAG_TYPE_COLORS[type] ?? { hex: "#4a9eff", bg: "bg-primary/10", text: "text-primary" };
}

// Coerce an OTel attribute value (which may arrive as string|number|boolean)
// to a string or null. Used by the OTel UI components.
export function asStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

// Same, returning empty string for missing values (display-friendly).
export function asString(v: unknown): string {
  return v == null ? "" : typeof v === "string" ? v : String(v);
}

// Coerce to a finite number or null.
export function asNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Coerce to a finite number, defaulting to 0 (for arithmetic).
export function asNumOr0(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
