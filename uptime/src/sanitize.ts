// Input sanitization for user-supplied incident text (write-time layer;
// esc() in render.ts remains the output-time layer).
//
// Why not DOMPurify: with linkedom (the only DOM that fits a Worker),
// DOMPurify v3.4.15 fails its own support probe and SILENTLY RETURNS THE
// DIRTY INPUT — verified in node against parseHTML windows with and without
// its required globals attached (isSupported stays undefined). A sanitizer
// that quietly no-ops is worse than none, so we parse with linkedom directly:
// its HTML parser never executes script, tags are dropped (text kept,
// entities decoded), and nothing can survive as markup.
import { parseHTML } from "linkedom";
const { document } = parseHTML('<!DOCTYPE html><html><body><div id="__sanitizer"></div></body></html>');
const holder = document.querySelector("#__sanitizer");

export function sanitizeUserText(raw: string): string {
  if (!holder) return raw.replace(/[<>]/g, "");
  holder.innerHTML = raw;
  return (holder.textContent ?? "").trim();
}
