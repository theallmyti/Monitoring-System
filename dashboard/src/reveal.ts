import { PointerEvent } from "react";

// Fluent "reveal": a soft light follows the pointer across a card (CSS uses --rx / --ry).
export function onReveal(e: PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--rx", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--ry", `${e.clientY - rect.top}px`);
}
