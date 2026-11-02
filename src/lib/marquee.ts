// Slow, readable scroll speed when revealing overflowing text on hover.
const MARQUEE_SPEED = 40

const frames = new WeakMap<HTMLElement, number>()

function cancel(element: HTMLElement) {
  const frame = frames.get(element)
  if (frame !== undefined) {
    window.cancelAnimationFrame(frame)
    frames.delete(element)
  }
}

// Toggle the edge fades: hide the left one until some text has scrolled off,
// and drop the right one once the end has been reached.
function syncEdgeFades(element: HTMLElement, distance: number) {
  const field = element.closest<HTMLElement>('.marquee-field')
  if (!field) return
  field.classList.toggle('is-marquee-at-start', element.scrollLeft <= 0.5)
  field.classList.toggle('is-marquee-at-end', element.scrollLeft >= distance - 0.5)
}

/**
 * Slowly scrolls an overflowing marquee element until its end (the tail) is
 * reached, then holds there. Pointer handling lives on the whole row, so this
 * is called for the row's `.marquee-text` element rather than the text itself.
 */
export function startMarquee(element: HTMLElement | null | undefined) {
  if (!element) return

  const distance = element.scrollWidth - element.clientWidth
  if (distance <= 1) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  cancel(element)
  element.classList.add('is-marquee-scrolling')
  element.closest<HTMLElement>('.marquee-field')?.classList.add('is-marquee-active')
  syncEdgeFades(element, distance)

  const duration = (distance / MARQUEE_SPEED) * 1000
  const startTime = window.performance.now()

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / duration)
    element.scrollLeft = distance * progress
    syncEdgeFades(element, distance)
    if (progress < 1) {
      frames.set(element, window.requestAnimationFrame(step))
    } else {
      frames.delete(element)
    }
  }

  frames.set(element, window.requestAnimationFrame(step))
}

export function resetMarquee(element: HTMLElement | null | undefined) {
  if (!element) return
  cancel(element)
  element.scrollLeft = 0
  element.classList.remove('is-marquee-scrolling')
  element
    .closest<HTMLElement>('.marquee-field')
    ?.classList.remove('is-marquee-active', 'is-marquee-at-start', 'is-marquee-at-end')
}
