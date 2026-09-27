import { useEffect, useMemo, useRef, useState } from 'react'
import { allNavItems } from './navConfig'
import './CommandPalette.css'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  navigate: (path: string) => void
}

function CommandPalette({ open, onClose, navigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? allNavItems.filter(
          (item) => item.label.toLowerCase().includes(q) || item.moduleLabel.toLowerCase().includes(q) || item.path.includes(q),
        )
      : allNavItems
    return list.slice(0, 40)
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      const timer = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  if (!open) return null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cmdk-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            placeholder="ابحث عن أي شاشة… (مثال: الطلبات، المخازن، الأدوار)"
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              }
              if (e.key === 'Enter') {
                const target = results[cursor]
                if (target) go(target.path)
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="cmdk-results">
          {results.length === 0 ? (
            <p className="cmdk-empty">لا توجد نتائج مطابقة</p>
          ) : (
            results.map((item, index) => (
              <button
                key={item.path}
                type="button"
                className={`cmdk-result ${index === cursor ? 'active' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(item.path)}
              >
                <span className="cmdk-result-icon">{item.icon}</span>
                <span className="cmdk-result-label">{item.label}</span>
                <span className="cmdk-result-module">{item.moduleLabel}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
