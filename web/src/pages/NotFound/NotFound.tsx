import { toArabicNumerals } from '../../utils/arabicNumerals'
import './NotFound.css'

interface NotFoundProps {
  navigate: (path: string) => void
}

function NotFound({ navigate }: NotFoundProps) {
  return (
    <div className="notfound-container">
      <div className="notfound-card">
        <div className="notfound-code">{toArabicNumerals('404')}</div>
        <h1 className="notfound-title">الصفحة غير موجودة</h1>
        <p className="notfound-message">
          الرابط الذي تحاول الوصول إليه غير صالح أو تم نقله. يرجى العودة إلى الصفحة الرئيسية.
        </p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          العودة للرئيسية
        </button>
      </div>
    </div>
  )
}

export default NotFound
