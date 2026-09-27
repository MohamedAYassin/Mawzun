import { useMemo, useState, type ReactNode } from 'react'
import './DataGrid.css'

export interface GridColumn<T> {
  key: string
  label: string
  /** Resolve the cell's plain value for filtering/exporting/grouping. */
  value?: (row: T) => string | number | null | undefined
}

export type FilterOp = 'contains' | 'eq' | 'neq' | 'gt' | 'lt' | 'empty' | 'notEmpty'

/** Shared props for the toolbar pictograms. Text glyphs (⚏ ⌗ ▦ ⤓ ⤒ ✕) render as stray
 *  typographic characters in this Arabic font, so every toolbar icon is an inline SVG. */
const ICON = {
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

interface FilterRow {
  id: number
  field: string
  op: FilterOp
  value: string
}

const OP_LABELS: Record<FilterOp, string> = {
  contains: 'يحتوي على',
  eq: 'يساوي',
  neq: 'لا يساوي',
  gt: 'أكبر من',
  lt: 'أصغر من',
  empty: 'فارغ',
  notEmpty: 'غير فارغ'
}

function cellValue<T>(row: T, col: GridColumn<T> | undefined): string {
  if (!col) return ''
  const v = col.value ? col.value(row) : (row as any)[col.key]
  return v === null || v === undefined ? '' : String(v)
}

function readCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const split = (line: string) => {
    const out: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') inQ = false; else cur += ch }
      else if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out
  }
  const headers = split(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = split(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

export function useDataGrid<T>({ storageKey, columns, rowKey }: {
  storageKey: string
  columns: GridColumn<T>[]
  rowKey: (row: T) => string | number
}) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`grid-hidden-${storageKey}`) || '[]') } catch { return [] }
  })
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [search, setSearch] = useState('')
  const [groupKey, setGroupKey] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Set<string | number>>(new Set())

  const visibleColumns = useMemo(() => columns.filter(c => !hidden.includes(c.key)), [columns, hidden])

  const toggleColumn = (key: string) => {
    setHidden(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      localStorage.setItem(`grid-hidden-${storageKey}`, JSON.stringify(next))
      return next
    })
  }

  const applyFilters = (rows: T[]): T[] => {
    // Free-text search runs first and spans every visible column, so it behaves
    // like the search box on the other list screens rather than a field filter.
    const term = search.trim().toLowerCase()
    const searched = term
      ? rows.filter(row =>
          visibleColumns.some(col => {
            const v = cellValue(row, col)
            return v !== null && v !== undefined && String(v).toLowerCase().includes(term)
          })
        )
      : rows

    const active = filters.filter(f => f.field && (f.op === 'empty' || f.op === 'notEmpty' || f.value !== ''))
    if (!active.length) return searched
    return searched.filter(row => active.every(f => {
      const col = columns.find(c => c.key === f.field)
      const v = cellValue(row, col)
      const needle = f.value.trim().toLowerCase()
      const target = v.toLowerCase()
      switch (f.op) {
        case 'contains': return target.includes(needle)
        case 'eq': return target === needle
        case 'neq': return target !== needle
        case 'gt': return Number(v) > Number(f.value)
        case 'lt': return Number(v) < Number(f.value)
        case 'empty': return target === ''
        case 'notEmpty': return target !== ''
      }
    }))
  }

  const applyGroup = (rows: T[]): { key: string; label: string; rows: T[] }[] => {
    if (!groupKey) return [{ key: '_', label: '', rows }]
    const col = columns.find(c => c.key === groupKey)
    const map = new Map<string, T[]>()
    for (const row of rows) {
      const label = cellValue(row, col) || '—'
      const bucket = map.get(label)
      if (bucket) bucket.push(row)
      else map.set(label, [row])
    }
    return [...map.entries()].map(([label, groupRows]) => ({ key: label, label, rows: groupRows }))
  }

  const exportCsv = (rows: T[], fileName: string) => {
    const headers = visibleColumns.map(c => c.label)
    const lines = rows.map(row => visibleColumns.map(c => {
      const v = cellValue(row, c)
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    }).join(','))
    const csv = '\uFEFF' + [headers.join(','), ...lines].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleRow = (row: T) => {
    const key = rowKey(row)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = (rows: T[]) => {
    setSelected(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(rowKey(r)))
      return allSelected ? new Set() : new Set(rows.map(rowKey))
    })
  }

  const clearSelection = () => setSelected(new Set())

  return {
    columns, visibleColumns, hidden, toggleColumn,
    filters, setFilters, applyFilters,
    search, setSearch,
    groupKey, setGroupKey, applyGroup,
    pageSize, setPageSize,
    selected, toggleRow, toggleAll, clearSelection, rowKey,
    exportCsv
  }
}

export type DataGridController<T> = ReturnType<typeof useDataGrid<T>>

export function DataGridToolbar<T>({ grid, rows, importable, onImport, actions }: {
  grid: DataGridController<T>
  rows: T[]
  importable?: boolean
  onImport?: (rows: Record<string, string>[]) => void
  actions?: ReactNode
}) {
  const [open, setOpen] = useState<'none' | 'filter' | 'group' | 'view'>('none')
  const toggle = (panel: typeof open) => setOpen(prev => prev === panel ? 'none' : panel)

  const doImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = readCsv(String(reader.result || ''))
      if (parsed.length && onImport) onImport(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  return (
    <div className="dg-toolbar">
      <div className="dg-toolbar-actions">
        <label className="dg-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={grid.search}
            onChange={(e) => grid.setSearch(e.target.value)}
            placeholder="ابحث في كل الأعمدة..."
            aria-label="بحث في الجدول"
          />
          {grid.search && (
            <button type="button" className="dg-search-clear" onClick={() => grid.setSearch('')} aria-label="مسح البحث">
              <svg {...ICON} width={11} height={11}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </label>
        {actions}
        <button type="button" className={`dg-btn ${open === 'filter' || grid.filters.length ? 'dg-btn-active' : ''}`} onClick={() => toggle('filter')}>
          <svg {...ICON}><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" /></svg>
          فلترة{grid.filters.length ? ` |${grid.filters.length} فلتر` : ''}
        </button>
        <button type="button" className={`dg-btn ${open === 'group' || grid.groupKey ? 'dg-btn-active' : ''}`} onClick={() => toggle('group')}>
          <svg {...ICON}><path d="M4 6h7v5H4zM13 13h7v5h-7zM13 6h7M4 18h7" /></svg>
          تجميع
        </button>
        <button type="button" className={`dg-btn ${open === 'view' ? 'dg-btn-active' : ''}`} onClick={() => toggle('view')}>
          <svg {...ICON}><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="9" cy="5" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="19" r="2" /></svg>
          عرض
        </button>
        <button type="button" className="dg-btn" onClick={() => grid.exportCsv(rows, 'export')}>
          <svg {...ICON}><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" /></svg>
          تصدير
        </button>
        {importable && onImport && (
          <label className="dg-btn">
            <svg {...ICON}><path d="M12 21V9m0 0-4 4m4-4 4 4M4 3h16" /></svg>
            استيراد
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.currentTarget.value = '' }} />
          </label>
        )}
        <select className="dg-pagesize" value={grid.pageSize} onChange={(e) => grid.setPageSize(Number(e.target.value))} aria-label="عدد الصفوف">
          {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {open === 'filter' && (
        <div className="dg-panel">
          {grid.filters.map((f, idx) => (
            <div className="dg-filter-row" key={f.id}>
              <select value={f.field} onChange={(e) => grid.setFilters(grid.filters.map((x, i) => i === idx ? { ...x, field: e.target.value } : x))}>
                <option value="">اختر الحقل</option>
                {grid.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select value={f.op} onChange={(e) => grid.setFilters(grid.filters.map((x, i) => i === idx ? { ...x, op: e.target.value as FilterOp } : x))}>
                {Object.entries(OP_LABELS).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
              </select>
              {f.op !== 'empty' && f.op !== 'notEmpty' && (
                <input value={f.value} onChange={(e) => grid.setFilters(grid.filters.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))} placeholder="القيمة" />
              )}
              <button type="button" className="dg-remove" onClick={() => grid.setFilters(grid.filters.filter((_, i) => i !== idx))}>✕</button>
            </div>
          ))}
          <div className="dg-panel-footer">
            <button type="button" className="dg-btn" onClick={() => grid.setFilters([...grid.filters, { id: Date.now(), field: '', op: 'contains', value: '' }])}>+ إضافة شرط</button>
            {grid.filters.length > 0 && <button type="button" className="dg-btn" onClick={() => grid.setFilters([])}>مسح الفلاتر</button>}
          </div>
        </div>
      )}

      {open === 'group' && (
        <div className="dg-panel">
          <div className="dg-filter-row">
            <select value={grid.groupKey} onChange={(e) => { grid.setGroupKey(e.target.value); setOpen('none') }}>
              <option value="">بدون تجميع</option>
              {grid.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {open === 'view' && (
        <div className="dg-panel dg-view-panel">
          {grid.columns.map(c => (
            <label key={c.key} className="dg-view-item">
              <input type="checkbox" checked={!grid.hidden.includes(c.key)} onChange={() => grid.toggleColumn(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function GridBulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null
  return (
    <div className="dg-bulkbar">
      <span className="dg-bulk-count">{count} محدد</span>
      {children}
      <button type="button" className="dg-btn" onClick={onClear}>إلغاء التحديد</button>
    </div>
  )
}
