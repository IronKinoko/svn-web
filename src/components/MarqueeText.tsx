import { useEffect, useRef } from 'react'
import { resetMarquee } from '../lib/marquee'

type MarqueeTextProps = {
  text: string
  className?: string
  title?: string
}

/**
 * Renders a path/name label that keeps the usual ellipsis when it does not fit.
 * Overflow scrolling is triggered from the surrounding row via `startMarquee`.
 * The left/right gradient fades are shown only while the text is scrolling.
 */
export function MarqueeText({ text, className, title }: MarqueeTextProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => () => resetMarquee(ref.current), [])

  return (
    <span
      className={className ? `marquee-field ${className}` : 'marquee-field'}
      title={title}
    >
      <span ref={ref} className="marquee-text">
        {text}
      </span>
      <span className="marquee-fade marquee-fade-left" aria-hidden="true" />
      <span className="marquee-fade marquee-fade-right" aria-hidden="true" />
    </span>
  )
}
