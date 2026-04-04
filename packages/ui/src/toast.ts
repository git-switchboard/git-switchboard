/** Minimal toast notification system */

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

export function showToast(message: string, duration = 3000): void {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  c.appendChild(el);
  // Trigger enter animation
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove());
    // Fallback removal
    setTimeout(() => el.remove(), 400);
  }, duration);
}
