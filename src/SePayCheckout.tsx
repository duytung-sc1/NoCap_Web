import { useEffect, useRef, useState } from 'react'
import { CreditCard, RotateCw, X } from 'lucide-react'
import { createSePayOrder, getEntitlement, getSePayOrder, getSePayPlans, type Entitlement, type SePayOrder, type SePayPlan, type SePayPlanId } from './api'
import { proPlanLabel } from './proPlans'
import { allowsPro } from './entitlements'
import type { Session } from './types'
import type { Lang } from './i18n'
import { readableError } from './sync'
import { trackWebFeature } from './webAnalytics'
import { WorkspacePricing } from './WorkspacePricing'

type Props = {
  session: Session | null; entitlement: Entitlement | null; lang: Lang
  onSignIn: () => void; onPaid: (value: Entitlement) => void; onExplore?: () => void
}

export function SePayCheckout(props: Props) {
  const [selectedPlan, setSelectedPlan] = useState<SePayPlanId>('MONTHLY')
  // Orders, quote requests and in-flight locks belong to one authenticated session.
  return <Checkout key={JSON.stringify([props.session?.token, props.session?.user.id])} {...props} selectedPlan={selectedPlan} onSelectPlan={setSelectedPlan} />
}

function Checkout({ session, entitlement, lang, onSignIn, onPaid, onExplore, selectedPlan, onSelectPlan }: Props & {
  selectedPlan: SePayPlanId; onSelectPlan: (id: SePayPlanId) => void
}) {
  const vi = lang === 'vi'
  const [order, setOrder] = useState<SePayOrder | null>(null)
  const [creating, setCreating] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [currentQuote, setQuote] = useState<{ plans: SePayPlan[]; error: string } | null>(null)
  const [quoteRetry, setQuoteRetry] = useState(0)
  const [paidRetry, setPaidRetry] = useState(0)
  const [expiredTransfer, setExpiredTransfer] = useState<{ id: string; expiresAt: number } | null>(null)
  const creatingRef = useRef(false)
  const orderRef = useRef<SePayOrder | null>(null)
  const checkRequestId = useRef(0)
  const paidOrderRef = useRef<string | null>(null)
  const paidFlightRef = useRef<{ token: string; id: string; promise: Promise<Entitlement> } | null>(null)
  const paidCallback = useRef(onPaid)
  const sessionRef = useRef(session)
  useEffect(() => { paidCallback.current = onPaid }, [onPaid])
  useEffect(() => {
    sessionRef.current = session
    return () => { sessionRef.current = null }
  }, [session])
  const orderId = order?.id
  const orderStatus = order?.status
  const orderExpiresAt = order?.expiresAt
  const transferExpired = orderStatus === 'PENDING' && expiredTransfer?.id === orderId && expiredTransfer?.expiresAt === orderExpiresAt
  const selectedQuote = currentQuote?.plans.find(plan => plan.id === selectedPlan)
  const activePro = allowsPro(entitlement, session)

  function replaceOrder(value: SePayOrder | null) {
    orderRef.current = value
    setOrder(value)
  }
  function closeOrder() {
    checkRequestId.current++
    replaceOrder(null)
    setChecking(false); setMessage('')
  }

  useEffect(() => {
    if (!orderId || orderStatus !== 'PENDING' || typeof orderExpiresAt !== 'number' || !Number.isFinite(orderExpiresAt)) return
    let timer: ReturnType<typeof setTimeout>
    const updateDeadline = () => {
      const remaining = orderExpiresAt - Date.now()
      if (remaining <= 0) setExpiredTransfer({ id: orderId, expiresAt: orderExpiresAt })
      else timer = setTimeout(updateDeadline, Math.min(remaining, 2_147_483_647))
    }
    updateDeadline()
    return () => clearTimeout(timer)
  }, [orderId, orderStatus, orderExpiresAt])

  useEffect(() => {
    let active = true
    void getSePayPlans().then(value => {
      if (active) setQuote({ plans: value.plans, error: '' })
    }).catch(error => { if (active) setQuote({ plans: [], error: readableError(error, lang) }) })
    return () => { active = false }
  }, [quoteRetry, lang])

  async function createOrder() {
    if (!session) { onSignIn(); return }
    if (creatingRef.current || !selectedQuote) return
    creatingRef.current = true
    setCreating(true); setMessage('')
    const token = session.token
    try {
      const value = await createSePayOrder(token, selectedPlan)
      if (sessionRef.current?.token === token) { replaceOrder(value); trackWebFeature('checkout_start') }
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
          if (!active || orderRef.current?.id !== orderId || next.id !== orderId) return
          // A slower pending response must not undo a confirmed terminal status.
          if (['PAID', 'EXPIRED'].includes(orderRef.current.status)) return
          replaceOrder(next); setMessage('')
          if (next.status === 'PAID' || next.status === 'EXPIRED') return
        } catch (error) { if (active && orderRef.current?.id === orderId) setMessage(readableError(error, lang)) }
      }
      if (active) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { active = false; clearTimeout(timer) }
  }, [session, orderId, orderStatus, lang])

  useEffect(() => {
    if (!session || !orderId || orderStatus !== 'PAID' || paidOrderRef.current === orderId) return
    let active = true
    const token = session.token
    const flight = paidFlightRef.current?.token === token && paidFlightRef.current.id === orderId
      ? paidFlightRef.current : { token, id: orderId, promise: getEntitlement(token) }
    paidFlightRef.current = flight
    const isCurrent = () => active && sessionRef.current?.token === token && orderRef.current?.id === orderId
    void flight.promise.then(value => {
      if (isCurrent()) { paidOrderRef.current = orderId; paidCallback.current(value); setMessage('') }
    }).catch(error => { if (isCurrent()) setMessage(readableError(error, lang)) })
      .finally(() => { if (paidFlightRef.current === flight) paidFlightRef.current = null })
    return () => { active = false }
  }, [session, orderId, orderStatus, lang, paidRetry])

  async function checkOrder() {
    if (!session || !order || checking) return
    const token = session.token
    const id = order.id
    const requestId = ++checkRequestId.current
    const isCurrent = () => sessionRef.current?.token === token && orderRef.current?.id === id && checkRequestId.current === requestId
    setChecking(true); setMessage('')
    try {
      const next = await getSePayOrder(token, id)
      if (!isCurrent() || next.id !== id) return
      if (!['PAID', 'EXPIRED'].includes(orderRef.current!.status) || next.status === orderRef.current!.status) replaceOrder(next)
      if (next.status === 'PAID') setPaidRetry(value => value + 1)
    } catch (error) { if (isCurrent()) setMessage(readableError(error, lang)) }
    finally { if (isCurrent()) setChecking(false) }
  }

  const statuses = vi ? { PENDING: 'Đang chờ chuyển khoản', PROCESSING: 'Đang xác nhận thanh toán', PAID: 'Đã thanh toán', EXPIRED: 'Đơn đã hết hạn' } : { PENDING: 'Awaiting transfer', PROCESSING: 'Confirming payment', PAID: 'Paid', EXPIRED: 'Order expired' }
  return <>
    <WorkspacePricing
      lang={lang} plan={selectedPlan} plans={currentQuote?.plans ?? []} signedIn={!!session} activePro={activePro} busy={creating}
      onPlan={id => { onSelectPlan(id); setMessage('') }} onExplore={onExplore}
      checkout={<>
        {!currentQuote && <p className="muted" role="status">{vi ? 'Đang tải giá gói…' : 'Loading plan prices…'}</p>}
        {currentQuote?.error && <><p className="form-message" role="alert">{currentQuote.error}</p><button type="button" className="secondary" onClick={() => setQuoteRetry(value => value + 1)}>{vi ? 'Tải lại giá gói' : 'Reload plan prices'}</button></>}
        {!order && message && <p className="form-message" role="alert">{message}</p>}
        <button type="button" className="primary" onClick={() => void createOrder()} disabled={creating || (!!session && !selectedQuote)}>
          <CreditCard size={17} aria-hidden="true" /> {creating ? (vi ? 'Đang tạo đơn…' : 'Creating order…') : !session ? (vi ? 'Đăng nhập để nâng cấp' : 'Sign in to upgrade') : activePro ? (vi ? 'Gia hạn qua SePay' : 'Renew via SePay') : (vi ? 'Nâng cấp qua SePay' : 'Upgrade via SePay')}
        </button>
      </>}
    />
    {order && <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) closeOrder() }}>
      <div className="dialog payment-dialog" role="dialog" aria-modal="true" aria-label={vi ? 'Thanh toán NoCap Pro' : 'NoCap Pro payment'}>
        <button className="icon-button dialog-close" onClick={closeOrder} aria-label={vi ? 'Đóng thanh toán' : 'Close payment'}><X size={19} /></button>
        <h2>{vi ? 'Thanh toán NoCap Pro' : 'NoCap Pro payment'}</h2>
        <p className="payment-status" role="status">{statuses[transferExpired ? 'EXPIRED' : order.status]}</p>
        {order.status === 'PAID' ? <p>{vi ? 'Giao dịch đã được máy chủ xác nhận. Gói Pro của bạn đang được cập nhật.' : 'The server confirmed your payment. Your Pro plan is being updated.'}</p> : order.status === 'PROCESSING' ? <p>{vi ? 'Máy chủ đang xác nhận giao dịch của bạn. Không chuyển khoản thêm cho đơn này.' : 'The server is confirming your transfer. Do not pay this order again.'}</p> : transferExpired ? <p>{vi ? 'Mã chuyển khoản đã hết hạn. Không chuyển khoản theo mã này. Kiểm tra trạng thái nếu bạn đã thanh toán.' : 'This transfer reference expired. Do not pay this reference. Check the status if you already paid.'}</p> : order.status === 'EXPIRED' ? <p>{vi ? 'Không chuyển khoản theo đơn này. Đóng cửa sổ và tạo đơn mới.' : 'Do not pay this expired order. Close the dialog and create a new one.'}</p> : <>
          <img className="payment-qr" src={order.qrUrl} alt={vi ? 'Mã QR chuyển khoản cho đơn NoCap Pro' : 'Bank-transfer QR for your NoCap Pro order'} />
          <dl className="payment-details">
            {order.planDays && <><dt>{vi ? 'Gói dịch vụ' : 'Plan'}</dt><dd>NoCap Pro · {proPlanLabel(order.planDays, lang)}</dd></>}
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
  </>
}
