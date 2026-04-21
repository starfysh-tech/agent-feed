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

export const FLAG_TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  decision:     { border: "border-l-[#4a9eff]", bg: "bg-[#1a2a3a]", text: "text-[#4a9eff]" },
  assumption:   { border: "border-l-[#f08030]", bg: "bg-[#2a1a0f]", text: "text-[#f08030]" },
  architecture: { border: "border-l-[#3dd68c]", bg: "bg-[#1a2a1a]", text: "text-[#3dd68c]" },
  pattern:      { border: "border-l-[#a070e8]", bg: "bg-[#2a1a2a]", text: "text-[#a070e8]" },
  dependency:   { border: "border-l-[#40b0f0]", bg: "bg-[#0f1a2a]", text: "text-[#40b0f0]" },
  tradeoff:     { border: "border-l-[#f0c040]", bg: "bg-[#2a2a0f]", text: "text-[#f0c040]" },
  constraint:   { border: "border-l-[#f05060]", bg: "bg-[#2a1010]", text: "text-[#f05060]" },
  workaround:   { border: "border-l-[#d0a030]", bg: "bg-[#1a1a0f]", text: "text-[#d0a030]" },
  risk:         { border: "border-l-[#f06070]", bg: "bg-[#2a1010]", text: "text-[#f06070]" },
};

export function getFlagColors(type: string) {
  return FLAG_TYPE_COLORS[type] ?? { border: "border-l-primary", bg: "bg-primary/10", text: "text-primary" };
}
