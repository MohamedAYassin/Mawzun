import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout/DashboardLayout'
import { systemApi, type SyncError, type SyncErrorStatus } from '../../lib/api'
import { SYNC_ERROR_TYPE_AR, labelOf } from '../../utils/enumLabels'
import { ModuleHeading, StatusBanner, ListToolbar, LoadingState, EmptyState, Button, AlertIcon, type Notice } from '../shared/ManagementUi'
import '../SystemSettings/SystemSettings.css'

interface SyncErrorsProps {
  navigate: (path: string) => void
}

const SYNC_STATUS_LABELS: Record<SyncErrorStatus, string> = {
  PENDING: 'قيد الانتظار',
  RESOLVED: 'تم الحل',
  IGNORED: 'مُتجاهل'
}

function SyncErrorsTab() {
  const [items, setItems] = useState<SyncError[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<SyncErrorStatus | ''>('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalEntries, setTotalEntries] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const load = useCallback(async (showLoader = true, currentPage = page, currentStatus = statusFilter) => {
    if (showLoader) setLoading(true)
    try {
      const result = await systemApi.listSyncErrors({ status: currentStatus || undefined, search: query || undefined, page: currentPage, pageSize: 10 })
      setItems(result.items)
      setTotalPages(result.totalPages)
      setTotalEntries(result.total)
      setLastLoaded(new Date())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل أخطاء المزامنة.' })
    } finally { setLoading(false) }
  }, [query, page, statusFilter])

  useEffect(() => { void load() }, [load])

  const toggleExpand = (item: SyncError) => {
    setExpandedId((prev) => (prev === item.id ? null : item.id))
  }

  const resolve = async (item: SyncError) => {
    setSaving(true); setNotice(null)
    try {
      await systemApi.resolveSyncError(item.id)
      setNotice({ type: 'success', text: 'تم تعليم الخطأ كمُحلول.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث الخطأ.' })
    } finally { setSaving(false) }
  }

  const retry = async (item: SyncError) => {
    setSaving(true); setNotice(null)
    try {
      await systemApi.retrySyncError(item.id)
      setNotice({ type: 'success', text: `أُعيدت جدولة المحاولة (محاولة رقم ${item.retryCount + 1}).` })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر إعادة المحاولة.' })
    } finally { setSaving(false) }
  }

  // Ignoring is the third terminal state a sync error can reach, next to
  // resolving and retrying. Without it an error that is understood but not
  // worth fixing stays PENDING and keeps the queue looking dirty.
  const ignore = async (item: SyncError) => {
    if (!window.confirm(`تجاهل خطأ المزامنة «${labelOf(SYNC_ERROR_TYPE_AR, item.errorType)}» الخاص بالمتجر «${item.storeName}»؟`)) return
    setSaving(true); setNotice(null)
    try {
      await systemApi.ignoreSyncError(item.id)
      setNotice({ type: 'success', text: 'تم تجاهل الخطأ.' })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تجاهل الخطأ.' })
    } finally { setSaving(false) }
  }

  const resolveAll = async () => {
    if (!window.confirm('تعليم كل أخطاء المزامنة المعلّقة كمُحلَّلة؟')) return
    setSaving(true); setNotice(null)
    try {
      const result = await systemApi.resolveAllSyncErrors()
      setNotice({ type: 'success', text: `تم تعليم ${result.updated} خطأ كمُحلَّل.` })
      await load(false)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'تعذر تحديث الأخطاء.' })
    } finally { setSaving(false) }
  }

  const applyStatusFilter = (next: SyncErrorStatus | '') => {
    setStatusFilter(next)
    setPage(1)
    void load(true, 1, next)
  }

  const goToPage = (next: number) => {
    setPage(next)
    void load(true, next, statusFilter)
  }

  return { items, query, setQuery, statusFilter, applyStatusFilter, page, totalPages, totalEntries, loading, saving, expandedId, notice, lastLoaded, load, toggleExpand, resolve, retry, ignore, resolveAll, goToPage }
}

function SyncErrorsView() {
  const t = SyncErrorsTab()
  return (
    <section className="ss-module animate-fade-in">
      <ModuleHeading icon={<AlertIcon />} eyebrow="العمليات" title="أخطاء المزامنة (Sync Errors)" subtitle="أخطاء مزامنة الطلبات والمنتجات مع المتاجر المربوطة وحالة معالجتها." />
      <div className="ss-module-actions">
        <span className="ss-count-chip"><strong>{t.totalEntries}</strong> خطأ</span>
        <Button variant="ghost" onClick={() => void t.load()} disabled={t.loading || t.saving}>تحديث</Button>
        {t.items.some((item) => item.status === 'PENDING') && (
          <Button variant="ghost" onClick={() => void t.resolveAll()} disabled={t.loading || t.saving}>تعليم الكل كمُحلَّل</Button>
        )}
      </div>
      <StatusBanner notice={t.notice} />
      <div className="ss-list-toolbar">
        <ListToolbar query={t.query} setQuery={t.setQuery} placeholder="ابحث بالمتجر أو رقم الطلب الخارجي..." lastLoaded={t.lastLoaded} />
        <label className="ss-search" style={{ minWidth: '150px' }}>
          <span>الحالة:</span>
          <select value={t.statusFilter} onChange={(event) => t.applyStatusFilter(event.target.value as SyncErrorStatus | '')} aria-label="تصفية بالحالة" className="ss-input">
            <option value="">الكل</option>
            {Object.entries(SYNC_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="ss-data-surface">
        {t.loading ? <LoadingState /> : t.items.length === 0 ? <EmptyState hasSearch={Boolean(t.query.trim())} /> : (
          <div className="ss-table-scroll">
            <table className="ss-table">
              <thead><tr><th>#</th><th>المتجر</th><th>نوع الخطأ</th><th>الرقم الخارجي</th><th>الرسالة</th><th>المحاولات</th><th>الحالة</th><th>التاريخ</th><th>حُلّ في</th><th className="ss-actions-column">الإجراءات</th></tr></thead>
              <tbody>
                {t.items.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="ss-row-number">{(t.page - 1) * 10 + index + 1}</span></td>
                    <td><span className="ss-item-name">{item.storeName}</span></td>
                    <td>
                      {/* Arabic label; the raw code stays available as a tooltip
                          so a support ticket can still name the exact type. */}
                      <span className="ss-related-badge" title={item.errorType}>
                        {labelOf(SYNC_ERROR_TYPE_AR, item.errorType)}
                      </span>
                    </td>
                    <td><span dir="ltr">{item.externalId || '—'}</span></td>
                    <td>
                      <button
                        className="ss-icon-button"
                        onClick={() => t.toggleExpand(item)}
                        title="عرض/إخفاء الرسالة الكاملة"
                        style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textAlign: 'right', cursor: 'pointer' }}
                      >
                        {item.errorMessage}
                      </button>
                      {t.expandedId === item.id && (
                        <div className="ss-inline-info" dir="ltr" style={{ marginTop: '0.4rem', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '220px', overflowY: 'auto' }}>
                          {item.errorMessage}
                        </div>
                      )}
                    </td>
                    <td><span>{item.retryCount}</span></td>
                    <td><span className="ss-related-badge" style={item.status === 'RESOLVED' ? { background: 'var(--color-success-soft)', color: 'var(--color-success)' } : { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>{SYNC_STATUS_LABELS[item.status] || item.status}</span></td>
                    <td><span>{new Date(item.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span></td>
                    <td><span>{item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span></td>
                    <td className="ss-actions-column">
                      <div className="ss-row-actions">
                        {item.status === 'PENDING' && (
                          <>
                            <button className="ss-icon-button ss-icon-edit" onClick={() => void t.retry(item)} disabled={t.saving} aria-label="إعادة المحاولة" title="إعادة المحاولة">↻</button>
                            <button className="ss-icon-button" onClick={() => void t.ignore(item)} disabled={t.saving} aria-label="تجاهل الخطأ" title="تجاهل">⊘</button>
                            <button className="ss-icon-button ss-icon-delete" onClick={() => void t.resolve(item)} disabled={t.saving} aria-label="تعليم كمُحلول" title="تعليم كمُحلول">✓</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {t.totalPages > 1 && (
        <div className="ss-list-toolbar" style={{ justifyContent: 'center' }}>
          <Button variant="ghost" onClick={() => t.goToPage(t.page - 1)} disabled={t.page <= 1 || t.loading}>السابق</Button>
          <span className="ss-count-chip">صفحة {t.page} من {t.totalPages} — {t.totalEntries} خطأ</span>
          <Button variant="ghost" onClick={() => t.goToPage(t.page + 1)} disabled={t.page >= t.totalPages || t.loading}>التالي</Button>
        </div>
      )}
    </section>
  )
}

export default function SyncErrors({ navigate }: SyncErrorsProps) {
  return (
    <DashboardLayout navigate={navigate}>
      <div className="view-container">
        <SyncErrorsView />
      </div>
    </DashboardLayout>
  )
}
