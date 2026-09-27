import { useState } from 'react'

interface RemoteImageProps {
  // Nullable, because every image column in the schema is: a brand, product or
  // category with no picture is a normal row, not a mistake to be coerced.
  path?: string | null
  placeholder?: string
  alt?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Renders a stored image inside a guaranteed box.
 *
 * The box is not optional. An <img> with no width/height renders at the file's
 * natural size, so one 4000px photo would blow the row — and its table — out of
 * the layout. The default below is the app's thumbnail size; a caller that needs
 * something else passes style/width, and the clamp still applies because
 * `maxWidth`/`maxHeight` are only overridable if the caller sets them
 * explicitly.
 *
 * A stored value that fails to load falls back to the placeholder via onError.
 */
export function RemoteImage({ path, placeholder = '📷', alt = '', className = '', style }: RemoteImageProps) {
  const [error, setError] = useState(false)

  // The bound every remote image gets, applied BEFORE the caller's style so a
  // caller can size it, but only inside this ceiling.
  const box: React.CSSProperties = {
    width: 44,
    height: 44,
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'cover',
    borderRadius: 8,
    display: 'block',
  }

  // Stored image values are public URLs (R2 public URL or external https),
  // so they render directly: the browser caches them like any other image
  // with no fetch round-trip.
  if (!path || error) {
    return (
      <div
        className={`remote-image-placeholder ${className}`}
        style={{ ...box, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary, #f0f0f0)', color: 'var(--text-muted, #888)', ...style }}
      >
        {placeholder}
      </div>
    )
  }

  return <img src={path} alt={alt} className={className} style={{ ...box, ...style }} onError={() => setError(true)} />
}

export default RemoteImage
