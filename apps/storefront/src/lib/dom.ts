/**
 * Null-tolerant DOM helpers. Merchants may delete any section of index.html; every helper
 * quietly no-ops when its target is missing so the rest of the page keeps working.
 */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function slot<T extends HTMLElement = HTMLElement>(name: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(`[data-slot="${name}"]`);
}

/** Sets textContent on a slot if it exists. */
export function setSlot(name: string, text: string, root: ParentNode = document): void {
  const el = slot(name, root);
  if (el) el.textContent = text;
}

export function show(el: HTMLElement | null): void {
  if (el) el.hidden = false;
}

export function hide(el: HTMLElement | null): void {
  if (el) el.hidden = true;
}

/** Clones a <template> body; null if the template was removed. */
export function cloneTemplate(id: string): DocumentFragment | null {
  const tpl = byId<HTMLTemplateElement>(id);
  return tpl ? (tpl.content.cloneNode(true) as DocumentFragment) : null;
}

/** First line of an error, trimmed for humans. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0];
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine;
}
