/* Minimal DOM helpers — hand-rolled UI, no framework, just less boilerplate. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, opts: { title?: string; class?: string } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (opts.title) b.title = opts.title;
  if (opts.class) b.className = opts.class;
  return b;
}

export function divider(): HTMLElement {
  return h('span', 'divider');
}

/** trailing-edge debounce */
export function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
