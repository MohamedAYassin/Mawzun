import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ApiError,
  BLOCKING_STATUSES,
  platformApi,
  type CompanyDirectoryEntry,
  type CompanyStatus,
} from '../../lib/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import '../SystemSettings/SystemSettings.css'
import './PlatformCompanies.css'

// The platform company directory.
//
// This is the only screen in the app that sees across companies, and it can
// only be reached by platform staff — users whose `companyId` is null. The
// guard lives in `src/routes/_platform/route.tsx`; the backend enforces the
// same thing on every request, so a directory row here is never the only thing
// standing between two companies.

type Notice = { type: 'success' | 'error' | 'info'; text: string }

const STATUS_LABELS: Record<CompanyStatus, string> = {
  ACTIVE: 'نشطة',
  SUSPENDED: 'معلقة',
  CLOSED: 'مغلقة',
}

/** Paging through a directory of companies, unlike the in-page reference lists. */
const PAGE_SIZE = 25

function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  )
}

const SearchIcon = () => <Icon size={16}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>
const RefreshIcon = () => <Icon><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></Icon>
const AlertIcon = () => <Icon size={16}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4.4 2.6 18a1.4 1.4 0 0 0 1.2 2h16.4a1.4 1.4 0 0 0 1.2-2L13.7 4.4a2 2 0 0 0-3.4 0Z" /></Icon>
const CheckIcon = () => <Icon size={16}><path d="m5 12 4 4L19 6" /></Icon>
const BuildingIcon = () => <Icon><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-5h6v5" /></Icon>
const ChevronRight = () => <Icon size={16}><path d="m9 6 6 6-6 6" /></Icon>
const ChevronLeft = () => <Icon size={16}><path d="m15 6-6 6 6 6" /></Icon>

function StatusBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <div className={`ss-status ss-status-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span className="ss-status-icon">{notice.type === 'success' ? <CheckIcon /> : <AlertIcon />}</span>
      <span>{notice.text}</span>
    </div>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ar-EG', { dateStyle: 'medium' })
}

/**
 * The status-change dialog.
 *
 * A reason is mandatory for SUSPENDED and CLOSED, and the check is duplicated
 * here rather than left to the server. Not because the server cannot be
 * trusted — it is the authority and it will refuse — but because a round trip
 * is the slowest possible way to tell someone a field is empty, and because
 * the reason is the only explanation the customer will ever get.
 */
function StatusDialog({
  company,
  onClose,
  onApplied,
}: {
  company: CompanyDirectoryEntry
  onClose: () => void
  onApplied: (message: string) => void
}) {
  const [status, setStatus] = useState<CompanyStatus>(company.status)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonRequired = (BLOCKING_STATUSES as readonly CompanyStatus[]).includes(status)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (reasonRequired && !reason.trim()) {
      setError('سبب التعليق أو الإغلاق مطلوب.')
      return
    }

    setSaving(true)
    try {
      await platformApi.setCompanyStatus(company.id, status, reason.trim() || undefined)
      onApplied(`تم تغيير حالة شركة «${company.name}» إلى ${STATUS_LABELS[status]}.`)
      onClose()
    } catch (err) {
      // The server's message is already in Arabic and already specific — a
      // suspended company that is already suspended, a reason that is too
      // long. Replacing it with a generic string would hide the answer.
      setError(err instanceof ApiError ? err.message : 'تعذّر تغيير حالة الشركة.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pc-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="pc-dialog-title">تغيير حالة الشركة</h3>
        <p className="pc-dialog-company">{company.name}</p>

        <form onSubmit={submit}>
          <div className="ss-editor-field">
            <label htmlFor="pc-status">الحالة الجديدة</label>
            <select
              id="pc-status"
              className="ss-input"
              value={status}
              onChange={(event) => setStatus(event.target.value as CompanyStatus)}
              disabled={saving}
            >
              <option value="ACTIVE">نشطة</option>
              <option value="SUSPENDED">معلقة</option>
              <option value="CLOSED">مغلقة</option>
            </select>
          </div>

          <div className="ss-editor-field">
            <label htmlFor="pc-reason">
              السبب {reasonRequired ? <span className="pc-required">*</span> : <span className="pc-optional">(اختياري)</span>}
            </label>
            <textarea
              id="pc-reason"
              className="ss-input"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                status === 'CLOSED'
                  ? 'مثال: طلب العميل إغلاق الحساب نهائياً.'
                  : 'مثال: عدم سداد الفاتورة المستحقة عن شهر أغسطس.'
              }
              disabled={saving}
            />
            {reasonRequired && (
              <p className="pc-hint">
                يُسجَّل هذا السبب في سجل التدقيق، وهو التفسير الوحيد الذي سيراه العميل عند التواصل مع الدعم.
              </p>
            )}
          </div>

          {status === 'SUSPENDED' || status === 'CLOSED' ? (
            <p className="pc-warning">
              سيتم إنهاء جميع الجلسات النشطة لمستخدمي هذه الشركة فوراً، ولن يتمكن أحد منهم من الدخول حتى تُعاد الشركة إلى حالة نشطة.
            </p>
          ) : null}

          {error && <p className="pc-error">{error}</p>}

          <div className="ss-multi-editor-actions">
            <button type="button" className="ss-button ss-button-ghost" onClick={onClose} disabled={saving}>
              إلغاء
            </button>
            <button type="submit" className="ss-button ss-button-primary" disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'تأكيد التغيير'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function PlatformCompanies() {
  const { isPlatformAdmin } = useCurrentUser()

  const [items, setItems] = useState<CompanyDirectoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [selected, setSelected] = useState<CompanyDirectoryEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await platformApi.listCompanies({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
      })
      setItems(result.items)
      setTotal(result.total)
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'تعذّر تحميل قائمة الشركات.',
      })
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  // The route guard renders nothing for company users, so reaching this branch
  // means the guard was bypassed — say so rather than showing an empty table.
  if (!isPlatformAdmin) {
    return (
      <div className="pc-page">
        <div className="ss-module">
          <StatusBanner
            notice={{ type: 'error', text: 'هذه الشاشة متاحة لإدارة المنصة فقط.' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pc-page">
      <section className="ss-module animate-fade-in">
        <div className="ss-module-heading">
          <div className="ss-module-icon"><BuildingIcon /></div>
          <div>
            <p className="ss-eyebrow">إدارة المنصة</p>
            <h2>دليل الشركات</h2>
            <p>كل الشركات المسجلة على المنصة، وحالتها، ومالكها.</p>
          </div>
        </div>

        <div className="ss-module-actions">
          <span className="ss-count-chip"><strong>{total}</strong> شركة</span>
          <button className="ss-button ss-button-ghost" onClick={() => void load()} disabled={loading}>
            <RefreshIcon /> تحديث
          </button>
        </div>

        <StatusBanner notice={notice} />

        <div className="ss-list-toolbar">
          <label className="ss-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="ابحث باسم الشركة..."
              aria-label="البحث في الشركات"
            />
          </label>
          <select
            className="ss-input pc-status-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as CompanyStatus | '')
              setPage(1)
            }}
            aria-label="تصفية حسب الحالة"
          >
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشطة</option>
            <option value="SUSPENDED">معلقة</option>
            <option value="CLOSED">مغلقة</option>
          </select>
        </div>

        <div className="ss-data-surface">
          {loading ? (
            <div className="ss-loading-list" aria-label="جاري التحميل">
              {[1, 2, 3, 4].map((row) => (
                <div className="ss-skeleton-row" key={row}><span /><span /><span /></div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="ss-empty-state">
              <div className="ss-empty-mark"><span>+</span></div>
              <h3>لا توجد شركات مطابقة</h3>
              <p>جرّب تغيير كلمة البحث أو امسح الفلتر الحالي.</p>
            </div>
          ) : (
            <div className="ss-table-scroll">
              <table className="ss-table">
                <thead>
                  <tr>
                    <th>الشركة</th>
                    <th>الحالة</th>
                    <th>المالك</th>
                    <th>المستخدمون</th>
                    <th>المنتجات</th>
                    <th>الطلبات</th>
                    <th>تاريخ الإنشاء</th>
                    <th className="ss-actions-column">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <span className="ss-item-name">{company.name}</span>
                        <span className="pc-sub">{company.slug}</span>
                      </td>
                      <td>
                        <span className={`pc-status pc-status-${company.status.toLowerCase()}`}>
                          {STATUS_LABELS[company.status]}
                        </span>
                      </td>
                      <td>
                        <span>{company.owner.fullName}</span>
                        <span className="pc-sub">{company.owner.email}</span>
                      </td>
                      <td><span className="ss-row-number">{company._count.users}</span></td>
                      <td><span className="ss-row-number">{company._count.products}</span></td>
                      <td><span className="ss-row-number">{company._count.orders}</span></td>
                      <td><span>{formatDate(company.createdAt)}</span></td>
                      <td className="ss-actions-column">
                        <button
                          className="ss-button ss-button-secondary"
                          onClick={() => {
                            setNotice(null)
                            setSelected(company)
                          }}
                        >
                          تغيير الحالة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="pc-pagination">
          <button
            className="ss-button ss-button-ghost"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={loading || page >= totalPages}
          >
            <ChevronRight /> السابق
          </button>
          <span>صفحة {page} من {totalPages}</span>
          <button
            className="ss-button ss-button-ghost"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={loading || page <= 1}
          >
            التالي <ChevronLeft />
          </button>
        </div>
      </section>

      {selected && (
        <StatusDialog
          company={selected}
          onClose={() => setSelected(null)}
          onApplied={(message) => {
            setNotice({ type: 'success', text: message })
            void load()
          }}
        />
      )}
    </div>
  )
}
