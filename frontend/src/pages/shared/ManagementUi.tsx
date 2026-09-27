import type { ReactNode } from 'react'
import '../SystemSettings/SystemSettings.css'

// Shared UI primitives for the management modules.
//
// One icon set plus the banner / button / empty / loading / toolbar states that
// every list-and-editor screen reuses, so a change here lands everywhere at once
// instead of being copied page by page.
//
// Used by the Customers, Vendors, Stores, API-keys, purchase-order and other
// management screens.

export type Notice = { type: 'success' | 'error' | 'info'; text: string }

export function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  )
}

export const PlusIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M12 5v14M5 12h14" /></Icon>
export const RefreshIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
export const SearchIcon = ({ size = 16 }: { size?: number }) => <Icon size={size}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>
export const EditIcon = () => <Icon size={16}><path d="m4 16-.7 4.7L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3L5 17" /><path d="m14.5 7.5 2 2" /></Icon>
export const TrashIcon = () => <Icon size={16}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
export const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
export const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
export const InfoIcon = () => <Icon size={16}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Icon>
export const UsersIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon>
export const TruckIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></Icon>
export const GlobeIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Icon>
export const KeyIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></Icon>
export const ClipboardIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></Icon>
export const TagIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>
export const BoxIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></Icon>
export const MapPinIcon = ({ size = 18 }: { size?: number }) => <Icon size={size}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></Icon>

export function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span className="ss-status-icon">{notice.type === 'success' ? <CheckIcon /> : notice.type === 'error' ? <AlertIcon /> : <InfoIcon />}</span>
      <span>{notice.text}</span>
    </div>
  )
}

export function Button({ children, variant = 'primary', type = 'button', onClick, disabled = false }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; onClick?: () => void; disabled?: boolean }) {
  return <button type={type} className={`ss-button ss-button-${variant}`} onClick={onClick} disabled={disabled}>{children}</button>
}

export function LoadingState() {
  return (
    <div className="ss-loading-list" aria-label="جاري التحميل">
      {[1, 2, 3, 4].map((item) => <div className="ss-skeleton-row" key={item}><span /><span /><span /></div>)}
    </div>
  )
}

export function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="ss-empty-state">
      <div className="ss-empty-mark"><span>+</span></div>
      <h3>{hasSearch ? 'لا توجد نتائج مطابقة' : 'لا توجد سجلات مضافة بعد'}</h3>
      <p>{hasSearch ? 'جرّب تغيير كلمات البحث أو امسح الفلتر الحالي.' : 'ابدأ بإضافة أول سجل ليظهر هنا.'}</p>
    </div>
  )
}

export function ListToolbar({ query, setQuery, placeholder, lastLoaded }: { query: string; setQuery: (v: string) => void; placeholder: string; lastLoaded: Date | null }) {
  return (
    <div className="ss-list-toolbar">
      <label className="ss-search">
        <SearchIcon />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </label>
      <span className="ss-last-loaded">{lastLoaded ? `آخر تحديث ${lastLoaded.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}` : 'جاري تجهيز القائمة'}</span>
    </div>
  )
}

export function ModuleHeading({ icon, eyebrow, title, subtitle }: { icon: ReactNode; eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="ss-module-heading">
      <div className="ss-module-icon">{icon}</div>
      <div>
        <p className="ss-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

export function ModuleActions({ count, countLabel, onRefresh, loading, saving, onAdd, addLabel }: { count: number; countLabel: string; onRefresh: () => void; loading: boolean; saving: boolean; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="ss-module-actions">
      <span className="ss-count-chip"><strong>{count}</strong> {countLabel}</span>
      <Button variant="ghost" onClick={onRefresh} disabled={loading || saving}><RefreshIcon /> تحديث</Button>
      {onAdd && <Button onClick={onAdd} disabled={saving}><PlusIcon /> {addLabel}</Button>}
    </div>
  )
}

export function EditorHeader({ editing, singular }: { editing: boolean; singular: string }) {
  return (
    <div className="ss-multi-editor-full">
      <span className="ss-editor-kicker">{editing ? 'تعديل السجل' : 'سجل جديد'}</span>
      <h3>{editing ? `تعديل ${singular}` : `إضافة ${singular}`}</h3>
    </div>
  )
}

export function EditorActions({ closeForm, saving, editing }: { closeForm: () => void; saving: boolean; editing: boolean }) {
  return (
    <div className="ss-multi-editor-actions">
      <Button variant="ghost" onClick={closeForm} disabled={saving}>إلغاء</Button>
      <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</Button>
    </div>
  )
}

export function RowActions({ onEdit, onDelete, saving, name }: { onEdit: () => void; onDelete: () => void; saving: boolean; name: string }) {
  return (
    <td className="ss-actions-column">
      <div className="ss-row-actions">
        <button className="ss-icon-button ss-icon-edit" onClick={onEdit} disabled={saving} aria-label={`تعديل ${name}`} title="تعديل"><EditIcon /></button>
        <button className="ss-icon-button ss-icon-delete" onClick={onDelete} disabled={saving} aria-label={`حذف ${name}`} title="حذف"><TrashIcon /></button>
      </div>
    </td>
  )
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return <span className="ss-related-badge" style={!isActive ? { background: 'var(--border-color)', color: 'var(--text-muted)' } : undefined}>{isActive ? 'نشط' : 'غير نشط'}</span>
}
