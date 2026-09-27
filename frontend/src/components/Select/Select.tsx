import { useState, useEffect, useRef } from 'react'
import './Select.css'

export type SelectValue = number | string

export interface SelectOption {
  value: SelectValue
  label: string
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  loading,
}: {
  value: SelectValue | undefined
  // Callers wire this directly to numeric state setters, so the parameter type
  // stays permissive on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (v: any) => void
  options: SelectOption[]
  disabled?: boolean
  placeholder?: string
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div className="custom-select" ref={ref}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => { if (!disabled && !loading) setOpen(!open) }}
        disabled={disabled}
      >
        <span>{loading ? 'جارٍ التحميل...' : selected ? selected.label : placeholder || 'اختر'}</span>
        <span aria-hidden className="custom-select-arrow">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="custom-select-dropdown">
          {options.map(opt => (
            <div
              key={opt.value}
              className={`custom-select-option ${opt.value === value ? 'custom-select-option-selected' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
