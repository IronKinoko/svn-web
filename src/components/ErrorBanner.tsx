import { X } from 'lucide-react'

type ErrorBannerProps = {
  message: string
  onDismiss: () => void
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  )
}
