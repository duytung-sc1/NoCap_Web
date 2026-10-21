import type { AdminPaymentReport } from './api'

const cell = (value: string | number | null | undefined) => {
  let safe = String(value ?? '')
  if (/^[\s\uFEFF]*[=+@-]/u.test(safe) || /^[\t\r\n]/u.test(safe)) safe = `'${safe}`
  return `"${safe.replace(/"/g, '""')}"`
}
const iso = (value: number | null) => value == null ? '' : new Date(value).toISOString()

/** Complete filtered export. Only explicit fields are serialized; timestamps are UTC ISO. */
export function paymentReportCsv(data: AdminPaymentReport) {
  if (data.hasMore || data.items.length !== data.totalRows) throw new Error('Incomplete payment export')
  const rows: (string | number | null | undefined)[][] = [
    ['report', 'NoCap SePay payments'], ['from', data.from], ['to', data.to], ['timezone', data.timezone],
    ['generated_at_utc', iso(data.generatedAt)], ['status_filter', data.filters.status], ['plan_filter', data.filters.plan], ['search_filter', data.filters.q],
    ['date_basis', 'PAID: paidAt; other statuses: createdAt'], ['currency', 'VND'],
    ['summary', 'orders', 'paid_orders', 'distinct_paying_customers', 'paid_amount_vnd'],
    ['total', data.summary.orders, data.summary.paidOrders, data.summary.paidCustomers, data.summary.paidAmount],
    ['undated_paid_orders_excluded_all_dates', data.undatedPaidOrders], [],
    ['plan_days', 'orders', 'paid_orders', 'distinct_paying_customers', 'paid_amount_vnd'],
    ...data.plans.map(row => [row.planDays, row.orders, row.paidOrders, row.paidCustomers, row.paidAmount]), [],
    ['date_vietnam', 'orders', 'paid_orders', 'distinct_paying_customers', 'paid_amount_vnd'],
    ...data.daily.map(row => [row.date, row.orders, row.paidOrders, row.paidCustomers, row.paidAmount]), [],
    ['status', 'orders'], ...data.statuses.map(row => [row.status, row.count]), [],
    ['order_id', 'user_id', 'email', 'display_name', 'payment_code', 'plan_days', 'amount_vnd', 'status', 'created_at_utc', 'paid_at_utc', 'recorded_at_utc', 'transaction_id', 'pro_expires_at_utc'],
    ...data.items.map(row => [row.id, row.userId, row.email, row.displayName, row.paymentCode, row.planDays, row.amount, row.status, iso(row.createdAt), iso(row.paidAt), iso(row.recordedAt), row.transactionId, row.status === 'PAID' ? iso(row.entitlementExpiresAt) : '']),
  ]
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

export function downloadPaymentReport(data: AdminPaymentReport) {
  const csv = paymentReportCsv(data)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `NoCap-Payments-${data.from}-${data.to}.csv`
  document.body.append(anchor)
  try { anchor.click() } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
