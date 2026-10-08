import { useEffect, useRef, useState } from 'react'
import { CreditCard, RotateCw, X } from 'lucide-react'
import { createSePayOrder, getEntitlement, getSePayOrder, getSePayPlans, type Entitlement, type SePayOrder, type SePayPlan, type SePayPlanId } from './api'
import type { Session } from './types'
import type { Lang } from './i18n'
import { readableError } from './sync'

export function SePayCheckout({ session, entitlement, lang, onSignIn, onPaid }: {
  session: Session | null; entitlement: Entitlement | null; lang: Lang
  onSignIn: () => void; onPaid: (value: Entitlement) => void
}) {
  const vi = lang === 'vi'
  const [order, setOrder] = useState<SePayOrder | null>(null)
  const [creating, setCreating] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<SePayPlanId>('MONTHLY')
  const [quote, setQuote] = useState<{ token: string; plans: SePayPlan[]; error: string } | null>(null)
  const [quoteRetry, setQuoteRetry] = useState(0)
  const creatingRef = useRef(false)
  const paidOrderRef = useRef<string | null>(null)
  const paidCallback = useRef(onPaid)
  const sessionRef = useRef(session)
  useEffect(() => { paidCallback.current = onPaid }, [onPaid])
  useEffect(() => {
    sessionRef.current = session
    return () => { sessionRef.current = null }
  }, [session])
  const orderId = order?.id
  const orderStatus = order?.status
  const currentQuote = quote?.token === session?.token ? quote : null
  const selectedQuote = currentQuote?.plans.find(plan => plan.id === selectedPlan)
  const price = (amount: number) => new Intl.NumberFormat(vi ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND' }).format(amount)

  useEffect(() => {
    if (!session) return
    let active = true
    const token = session.token
    void getSePayPlans(token).then(value => {
      if (active) setQuote({ token, plans: value.plans, error: '' })
    }).catch(error => { if (active) setQuote({ token, plans: [], error: readableError(error, lang) }) })
    return () => { active = false }
  }, [session, quoteRetry, lang])

  async function createOrder() {
    if (!session) { onSignIn(); return }
    if (creatingRef.current || !selectedQuote) return
    creatingRef.current = true
    setCreating(true); setMessage('')
    const token = session.token
    try {
      const value = await createSePayOrder(token, selectedPlan)
      if (sessionRef.current?.token === token) setOrder(value)
    } catch (error) {
      if (sessionRef.current?.token === token) setMessage(readableError(error, lang))
    } finally { creatingRef.current = false; setCreating(false) }
  }

  // Poll only this user's pending order; the backend alone confirms payment.
  useEffect(() => {
    if (!session || !orderId || !orderStatus || !['PENDING', 'PROCESSING'].includes(orderStatus)) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!active) return
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          const next = await getSePayOrder(session.token, orderId)
          if (!active) return
          setOrder(next); setMessage('')
          if (next.status === 'PAID' || next.status === 'EXPIRED') return
        } catch (error) { if (active) setMessage(readableError(error, lang)) }
      }
      if (active) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { active = false; clearTimeout(timer) }
  }, [session, orderId, orderStatus, lang])

  useEffect(() => {
    if (!session || !orderId || orderStatus !== 'PAID' || paidOrderRef.current === orderId) return
    let active = true
    void getEntitlement(session.token).then(value => {
      if (active) { paidOrderRef.current = orderId; paidCallback.current(value) }
    }).catch(error => { if (active) setMessage(readableError(error, lang)) })
    return () => { active = false }
  }, [session, orderId, orderStatus, lang])

  async function checkOrder() {
    if (!session || !order || checking) return
    const token = session.token
    setChecking(true); setMessage('')
    try {
      const next = await getSePayOrder(token, order.id)
      if (sessionRef.current?.token === token) setOrder(next)
      if (next.status === 'PAID') {
        const value = await getEntitlement(token)
        if (sessionRef.current?.token === token) { paidOrderRef.current = next.id; paidCallback.current(value) }
      }
    } catch (error) { if (sessionRef.current?.token === token) setMessage(readableError(error, lang)) }
    finally { setChecking(false) }
  }

  const statuses = vi ? { PENDING: 'Đang chờ chuyển khoản', PROCESSING: 'Đang xác nhận thanh toán', PAID: 'Đã thanh toán', EXPIRED: 'Đơn đã hết hạn' } : { PENDING: 'Awaiting transfer', PROCESSING: 'Confirming payment', PAID: 'Paid', EXPIRED: 'Order expired' }
  return <section className="settings-card">
    <h2>NoCap Pro · SePay</h2>
    <p className="muted">{vi ? 'Thanh toán chuyển khoản bằng mã QR. NoCap tự xác nhận và cập nhật gói sau khi nhận được giao dịch.' : 'Pay by bank-transfer QR. NoCap confirms the transfer and updates your plan automatically.'}</p>
    <div className="pro-benefits"><p>{vi ? 'Free: đọc sách, ghi chú, xuất Markdown và ôn tập từng thẻ.' : 'Free: reading, notes, Markdown export and individual review cards.'}</p><p>{vi ? 'Pro: Đọc ẩn và tạo thẻ ôn tự động trên Web và các tính năng Pro tương ứng trên Android. Xuất PDF/Anki hiện có trên Android.' : 'Pro: Stealth Reading and automatic review-card generation on Web and corresponding Pro features on Android. PDF/Anki export is currently available on Android.'}</p></div>
    <fieldset className="pro-plan-options">
      <legend>{vi ? 'Chọn thời hạn Pro' : 'Choose your Pro plan'}</legend>
      {(['MONTHLY', 'YEARLY'] as const).map(id => {
        const plan = currentQuote?.plans.find(value => value.id === id)
        return <label key={id} className={`pro-plan-option ${selectedPlan === id ? 'selected' : ''}`}>
          <input type="radio" name="pro-plan" value={id} checked={selectedPlan === id} onChange={() => setSelectedPlan(id)} disabled={creating} />
          <span className="pro-plan-copy">
            <strong>{id === 'YEARLY' ? (vi ? '1 năm' : '1 year') : (vi ? '30 ngày' : '30 days')}</strong>
            {id === 'YEARLY' && <span className="pro-plan-discount">{vi ? 'Giảm 40%' : '40% off'}</span>}
            {plan && <span className="pro-plan-price">{id === 'YEARLY' && <del>{price(plan.regularAmount)}</del>}<b>{price(plan.amount)}</b></span>}
          </span>
        </label>
      })}
    </fieldset>
    {session && !currentQuote && <p className="muted" role="status">{vi ? 'Đang tải giá gói…' : 'Loading plan prices…'}</p>}
    {currentQuote?.error && <><p className="form-message" role="alert">{currentQuote.error}</p><button className="secondary" onClick={() => setQuoteRetry(value => value + 1)}>{vi ? 'Tải lại giá gói' : 'Reload plan prices'}</button></>}
    <button className="secondary" onClick={() => void createOrder()} disabled={creating || (!!session && !selectedQuote)}>
      <CreditCard size={17} /> {creating ? (vi ? 'Đang tạo đơn…' : 'Creating order…') : !session ? (vi ? 'Đăng nhập để nâng cấp' : 'Sign in to upgrade') : entitlement?.plan === 'PRO' ? (vi ? 'Gia hạn qua SePay' : 'Renew via SePay') : (vi ? 'Nâng cấp qua SePay' : 'Upgrade via SePay')}
    </button>
    {!order && message && <p className="form-message" role="alert">{message}</p>}
    {order && <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) setOrder(null) }}>
      <div className="dialog payment-dialog" role="dialog" aria-modal="true" aria-label={vi ? 'Thanh toán NoCap Pro' : 'NoCap Pro payment'}>
        <button className="icon-button dialog-close" onClick={() => setOrder(null)} aria-label={vi ? 'Đóng thanh toán' : 'Close payment'}><X size={19} /></button>
        <h2>{vi ? 'Thanh toán NoCap Pro' : 'NoCap Pro payment'}</h2>
        <p className="payment-status" role="status">{statuses[order.status]}</p>
        {order.status === 'PAID' ? <p>{vi ? 'Giao dịch đã được máy chủ xác nhận. Gói Pro của bạn đang được cập nhật.' : 'The server confirmed your payment. Your Pro plan is being updated.'}</p> : order.status === 'EXPIRED' ? <p>{vi ? 'Không chuyển khoản theo đơn này. Đóng cửa sổ và tạo đơn mới.' : 'Do not pay this expired order. Close the dialog and create a new one.'}</p> : <>
          <img className="payment-qr" src={order.qrUrl} alt={vi ? 'Mã QR chuyển khoản cho đơn NoCap Pro' : 'Bank-transfer QR for your NoCap Pro order'} />
          <dl className="payment-details">
            {order.planDays && <><dt>{vi ? 'Gói dịch vụ' : 'Plan'}</dt><dd>NoCap Pro · {order.planDays === 365 ? (vi ? '1 năm (365 ngày)' : '1 year (365 days)') : `${order.planDays} ${vi ? 'ngày' : 'days'}`}</dd></>}
            <dt>{vi ? 'Số tiền' : 'Amount'}</dt><dd><strong>{new Intl.NumberFormat(vi ? 'vi-VN' : 'en-US', { style: 'currency', currency: order.currency }).format(order.amount)}</strong></dd>
            <dt>{vi ? 'Ngân hàng' : 'Bank'}</dt><dd>{order.bank.name}</dd>
            <dt>{vi ? 'Số tài khoản' : 'Account number'}</dt><dd>{order.bank.accountNumber}</dd>
            <dt>{vi ? 'Chủ tài khoản' : 'Account holder'}</dt><dd>{order.bank.accountHolder}</dd>
            <dt>{vi ? 'Nội dung' : 'Reference'}</dt><dd><strong>{order.paymentContent}</strong></dd>
            <dt>{vi ? 'Hết hạn' : 'Expires'}</dt><dd>{new Date(order.expiresAt).toLocaleString(vi ? 'vi-VN' : 'en-US')}</dd>
          </dl>
          <p className="muted">{vi ? 'Chuyển đúng số tiền và giữ nguyên nội dung. Cửa sổ tự kiểm tra trạng thái mỗi 5 giây.' : 'Use the exact amount and reference. This dialog checks the status every 5 seconds.'}</p>
        </>}
        {message && <p className="form-message" role="alert">{message}</p>}
        {order.status !== 'EXPIRED' && <button className="secondary" onClick={() => void checkOrder()} disabled={checking}><RotateCw size={16} /> {checking ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? 'Kiểm tra thanh toán' : 'Check payment')}</button>}
      </div>
    </div>}
  </section>
}
