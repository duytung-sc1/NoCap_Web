import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '../types'
import { t, type Lang } from '../i18n'
import {
  extractBookRows,
  PANIC_CORPORATE_ROWS,
  type StealthRow
} from './textExtractor'
import './StealthReader.css'

export type DisguiseMode = 'excel' | 'vscode' | 'doc'

interface Props {
  book: Book
  bytes: ArrayBuffer
  lang: Lang
  initialProgression?: number
  onClose: () => void
  onExitHome?: () => void
  onProgressChange?: (progression: number) => void
}

export function StealthReader({
  book,
  bytes,
  lang,
  initialProgression = 0,
  onClose,
  onExitHome,
  onProgressChange,
}: Props) {
  const curT = t[lang].stealth
  const [mode, setMode] = useState<DisguiseMode>('excel')
  const [panic, setPanic] = useState(false)
  const [rows, setRows] = useState<StealthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRowIndex, setActiveRowIndex] = useState(0)
  const [fontSize, setFontSize] = useState(12)
  const [opacity, setOpacity] = useState(1)
  const [autoScroll, setAutoScroll] = useState(false)
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(6) // seconds per row
  const [search, setSearch] = useState('')

  const activeRowRef = useRef<HTMLTableRowElement | HTMLDivElement | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Extract text on mount
  useEffect(() => {
    let alive = true
    setLoading(true)

    void (async () => {
      try {
        const extracted = await extractBookRows(book, bytes)
        if (!alive) return
        setRows(extracted)
        if (initialProgression > 0 && extracted.length > 0) {
          const targetIndex = Math.floor(initialProgression * extracted.length)
          setActiveRowIndex(Math.min(extracted.length - 1, Math.max(0, targetIndex)))
        }
      } catch {
        if (!alive) return
        setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => { alive = false }
  }, [book, bytes, initialProgression])

  // Filtered rows
  const displayRows = useMemo(() => {
    if (panic) return PANIC_CORPORATE_ROWS
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => r.text.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
  }, [panic, rows, search])

  // Active row data
  const currentRow = displayRows[activeRowIndex] || displayRows[0] || {
    index: 1,
    id: 'SYS-1001',
    category: 'INIT',
    text: '',
    status: 'Ready',
    variance: '0%',
    timestamp: '00:00:00'
  }

  // Notify parent of progress
  useEffect(() => {
    if (panic || !rows.length || !onProgressChange) return
    const pct = Math.min(1, Math.max(0, activeRowIndex / rows.length))
    onProgressChange(pct)
  }, [activeRowIndex, rows.length, panic, onProgressChange])

  // Keyboard navigation & Boss Key hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'

      // If user is currently typing in search field
      if (isInput) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur()
          if (search) setSearch('')
        }
        return
      }

      // F2: Toggle Stealth Mode (exit back to normal reader)
      if (e.key === 'F2') {
        e.preventDefault()
        onClose()
        return
      }

      // Escape: Exit reader completely to Home
      if (e.key === 'Escape') {
        e.preventDefault()
        if (panic) {
          setPanic(false)
        } else if (onExitHome) {
          onExitHome()
        } else {
          onClose()
        }
        return
      }

      // F12 or Alt+P: Panic Button Toggle (Boss Key disguise)
      if (e.key === 'F12' || (e.altKey && (e.key === 'p' || e.key === 'P'))) {
        e.preventDefault()
        setPanic(prev => !prev)
        return
      }

      // Down / Space / j: Next row
      if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'j') {
        e.preventDefault()
        setActiveRowIndex(prev => Math.min(displayRows.length - 1, prev + 1))
        return
      }

      // Up / k: Previous row
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setActiveRowIndex(prev => Math.max(0, prev - 1))
        return
      }

      // PageDown: Skip forward 15 rows
      if (e.key === 'PageDown') {
        e.preventDefault()
        setActiveRowIndex(prev => Math.min(displayRows.length - 1, prev + 15))
        return
      }

      // PageUp: Skip back 15 rows
      if (e.key === 'PageUp') {
        e.preventDefault()
        setActiveRowIndex(prev => Math.max(0, prev - 15))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [displayRows.length, onClose, onExitHome, panic, search])

  // Auto-advance rows
  useEffect(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current)
      autoScrollTimer.current = null
    }

    if (autoScroll && !panic && displayRows.length > 0) {
      autoScrollTimer.current = setInterval(() => {
        setActiveRowIndex(prev => {
          if (prev >= displayRows.length - 1) {
            setAutoScroll(false)
            return prev
          }
          return prev + 1
        })
      }, autoScrollSpeed * 1000)
    }

    return () => {
      if (autoScrollTimer.current) clearInterval(autoScrollTimer.current)
    }
  }, [autoScroll, autoScrollSpeed, panic, displayRows.length])

  // Auto-scroll the active row into viewport
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'nearest'
      })
    }
  }, [activeRowIndex])

  return (
    <div className="stealth-wrapper" style={{ opacity }}>
      {/* Top Discreet Toolbar */}
      <header className="stealth-control-bar" role="toolbar" aria-label="Stealth Toolbar">
        <div className="stealth-control-left">
          {/* Panic Button */}
          <button
            className={`stealth-chip-btn ${panic ? 'stealth-unpanic-btn' : 'stealth-panic-btn'}`}
            onClick={() => setPanic(!panic)}
            title={panic ? curT.unpanicBtn : curT.panicBtn}
          >
            {panic ? curT.unpanicBtn : curT.panicBtn}
          </button>

          {/* Mode Switchers */}
          <button
            className={`stealth-chip-btn ${mode === 'excel' ? 'active' : ''}`}
            onClick={() => setMode('excel')}
          >
            📊 {curT.excelMode}
          </button>
          <button
            className={`stealth-chip-btn ${mode === 'vscode' ? 'active' : ''}`}
            onClick={() => setMode('vscode')}
          >
            💻 {curT.vscodeMode}
          </button>
          <button
            className={`stealth-chip-btn ${mode === 'doc' ? 'active' : ''}`}
            onClick={() => setMode('doc')}
          >
            📄 {curT.docMode}
          </button>
        </div>

        <div className="stealth-control-right">
          {/* Auto Scroll Toggle */}
          <label className="stealth-slider-label">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            {curT.autoScroll} ({autoScrollSpeed}s)
          </label>

          {autoScroll && (
            <input
              type="range"
              min="2"
              max="20"
              value={autoScrollSpeed}
              onChange={e => setAutoScrollSpeed(Number(e.target.value))}
              title={`${curT.autoScrollSpeed}: ${autoScrollSpeed}s`}
            />
          )}

          {/* Font Size */}
          <label className="stealth-slider-label">
            {curT.fontSizeLabel}: {fontSize}px
            <input
              type="range"
              min="10"
              max="16"
              value={fontSize}
              onChange={e => setFontSize(Number(e.target.value))}
            />
          </label>

          {/* Opacity */}
          <label className="stealth-slider-label">
            {curT.opacityLabel}: {Math.round(opacity * 100)}%
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={opacity}
              onChange={e => setOpacity(Number(e.target.value))}
            />
          </label>

          {/* Exit directly to Home */}
          <button
            type="button"
            className="stealth-chip-btn stealth-home-btn"
            style={{ fontWeight: 600, background: '#107c41', color: '#fff', borderColor: '#107c41' }}
            onClick={onExitHome || onClose}
            title={lang === 'vi' ? 'Thoát ra Trang chủ (Esc)' : 'Exit to Home (Esc)'}
          >
            🏠 {curT.exitHome || (lang === 'vi' ? 'Trang chủ (Esc)' : 'Home (Esc)')}
          </button>

          {/* Exit to normal reader */}
          <button
            className="stealth-chip-btn"
            style={{ fontWeight: 600, borderColor: '#0078d4' }}
            onClick={onClose}
            title={curT.exitStealth}
          >
            ✕ {curT.exitStealth} (F2)
          </button>
        </div>
      </header>

      {/* Main Disguised View */}
      {mode === 'excel' && (
        <ExcelView
          rows={displayRows}
          currentRow={currentRow}
          activeRowIndex={activeRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={setActiveRowIndex}
          fontSize={fontSize}
          panic={panic}
          loading={loading}
          curT={curT}
          lang={lang}
          search={search}
          onSearchChange={setSearch}
        />
      )}

      {mode === 'vscode' && (
        <VsCodeView
          rows={displayRows}
          activeRowIndex={activeRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={setActiveRowIndex}
          fontSize={fontSize}
          panic={panic}
          loading={loading}
          curT={curT}
          lang={lang}
        />
      )}

      {mode === 'doc' && (
        <DocView
          bookTitle={book.title}
          rows={displayRows}
          activeRowIndex={activeRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={setActiveRowIndex}
          fontSize={fontSize}
          panic={panic}
          loading={loading}
          curT={curT}
          lang={lang}
        />
      )}
    </div>
  )
}

export interface StealthTranslations {
  btnTitle: string
  btnLabel: string
  excelMode: string
  vscodeMode: string
  docMode: string
  panicBtn: string
  unpanicBtn: string
  exitHome?: string
  exitStealth: string
  autoScroll: string
  autoScrollSpeed: string
  opacityLabel: string
  fontSizeLabel: string
  searchPrompt: string
  excelFormula: string
  excelSheetMain: string
  excelSheetAudit: string
  excelSheetMetrics: string
  vscodeStatus: string
  vscodeterminal: string
  readingProgress: (pct: number) => string
  keyboardGuide: string
  panicNotice: string
}

/* ================== EXCEL VIEW COMPONENT ================== */
interface SubViewProps {
  rows: StealthRow[]
  activeRowIndex: number
  activeRowRef: React.RefObject<HTMLTableRowElement | HTMLDivElement | null>
  onSelectRow: (index: number) => void
  fontSize: number
  panic: boolean
  loading: boolean
  curT: StealthTranslations
  lang?: Lang
}

function ExcelView({
  rows,
  currentRow,
  activeRowIndex,
  activeRowRef,
  onSelectRow,
  fontSize,
  panic,
  loading,
  curT,
  lang = 'vi',
  search,
  onSearchChange,
}: SubViewProps & {
  currentRow: StealthRow
  search: string
  onSearchChange: (val: string) => void
}) {
  const WINDOW_SIZE = 70
  const startIdx = Math.max(0, activeRowIndex - 20)
  const endIdx = Math.min(rows.length, startIdx + WINDOW_SIZE)
  const windowedRows = rows.slice(startIdx, endIdx)

  return (
    <div className="excel-container">
      {/* Title bar */}
      <div className="excel-titlebar">
        <div className="excel-title-left">
          <span className="excel-autosave-badge">AutoSave • On</span>
          <span className="excel-filename">Q4_Consolidated_Financial_Model_v4.2.xlsx - Saved to OneDrive</span>
        </div>
        <div style={{ fontSize: '11px', opacity: 0.9 }}>
          {panic ? '⚠️ ISO-27001 AUDIT MODE' : `Row ${activeRowIndex + 1} of ${rows.length}`}
        </div>
      </div>

      {/* Ribbon tabs */}
      <div className="excel-ribbon-tabs">
        <div className="excel-ribbon-tab active">Home</div>
        <div className="excel-ribbon-tab">Insert</div>
        <div className="excel-ribbon-tab">Page Layout</div>
        <div className="excel-ribbon-tab">Formulas</div>
        <div className="excel-ribbon-tab">Data</div>
        <div className="excel-ribbon-tab">Review</div>
        <div className="excel-ribbon-tab">View</div>
        <div className="excel-ribbon-tab">Automate</div>
      </div>

      {/* Ribbon tools */}
      <div className="excel-ribbon-tools">
        <div className="excel-tool-group">
          <select className="excel-font-select" defaultValue="Aptos">
            <option>Aptos</option>
            <option>Calibri</option>
            <option>Segoe UI</option>
          </select>
          <select className="excel-font-select" defaultValue={String(fontSize)}>
            <option value="10">10</option>
            <option value="11">11</option>
            <option value="12">12</option>
            <option value="14">14</option>
          </select>
        </div>
        <div className="excel-tool-group">
          <strong>B</strong> <em>I</em> <u>U</u>
        </div>
        <div className="excel-tool-group">
          <span>Alignment: Left</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="text"
            placeholder={curT.searchPrompt}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            style={{ height: '22px', fontSize: '11px', padding: '0 6px', border: '1px solid #c8c6c4', borderRadius: '2px', width: '180px' }}
          />
        </div>
      </div>

      {/* Formula Bar */}
      <div className="excel-formula-bar">
        <div className="excel-name-box">C{activeRowIndex + 1}</div>
        <div className="excel-fx-icon">fx</div>
        <div className="excel-formula-input" title={currentRow.text}>
          {panic
            ? `=CONCATENATE("AUDIT_MEMO: ", "${currentRow.text}")`
            : `=XLOOKUP(C${activeRowIndex + 1}, NARRATIVE_STREAM, "${currentRow.text.slice(0, 100)}...") : ${currentRow.text}`}
        </div>
      </div>

      {/* Table Grid */}
      <div className="excel-grid-container">
        {loading ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#605e5c', fontSize: '12px' }}>
            <p>Connecting to OLAP Analytical Database…</p>
            <p style={{ opacity: 0.7 }}>Loading workbook segments…</p>
          </div>
        ) : (
          <table className="excel-table" style={{ fontSize: `${fontSize}px` }}>
            <thead>
              <tr>
                <th className="excel-th" style={{ width: '44px' }}>#</th>
                <th className="excel-th" style={{ width: '110px' }}>A (REC_ID)</th>
                <th className="excel-th" style={{ width: '130px' }}>B (KPI_CATEGORY)</th>
                <th className="excel-th">C (ANALYTICS_MEMO / NARRATIVE)</th>
                <th className="excel-th" style={{ width: '110px' }}>D (STATUS)</th>
                <th className="excel-th" style={{ width: '90px' }}>E (VARIANCE)</th>
              </tr>
            </thead>
            <tbody>
              {startIdx > 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', background: '#f8fafc', color: '#64748b', fontSize: '11px', padding: '6px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.max(0, activeRowIndex - 35))}>
                    {lang === 'vi'
                      ? `▲ Đang hiển thị từ dòng ${startIdx + 1}. Bấm để cuộn lên (${startIdx} dòng trước)...`
                      : `▲ Showing from row ${startIdx + 1}. Click to scroll up (${startIdx} rows earlier)...`}
                  </td>
                </tr>
              )}
              {windowedRows.map((row, offset) => {
                const actualIndex = startIdx + offset
                const isSelected = actualIndex === activeRowIndex
                return (
                  <tr
                    key={`${actualIndex}-${row.id}`}
                    ref={isSelected ? (activeRowRef as React.RefObject<HTMLTableRowElement>) : null}
                    className={`excel-tr ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectRow(actualIndex)}
                  >
                    <td className="excel-row-num">{actualIndex + 1}</td>
                    <td className="excel-td id-col">{row.id}</td>
                    <td className="excel-td cat-col">{row.category}</td>
                    <td className="excel-td text-col">{row.text}</td>
                    <td className="excel-td status-col">{row.status}</td>
                    <td className="excel-td var-col">{row.variance}</td>
                  </tr>
                )
              })}
              {endIdx < rows.length && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', background: '#f8fafc', color: '#64748b', fontSize: '11px', padding: '6px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.min(rows.length - 1, activeRowIndex + 35))}>
                    {lang === 'vi'
                      ? `▼ Còn ${rows.length - endIdx} dòng tiếp theo. Bấm để xem tiếp...`
                      : `▼ ${rows.length - endIdx} more rows ahead. Click to load more...`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Excel Sheet Tabs at Bottom */}
      <div className="excel-footer-tabs">
        <div className="excel-tabs-list">
          <div className="excel-sheet-tab active">📊 {curT.excelSheetMain}</div>
          <div className="excel-sheet-tab">📈 {curT.excelSheetAudit}</div>
          <div className="excel-sheet-tab">📋 {curT.excelSheetMetrics}</div>
          <div className="excel-sheet-tab" style={{ cursor: 'pointer', fontWeight: 'bold' }}>+</div>
        </div>
        <div className="excel-status-info">
          <button style={{ background: '#ffffff', border: '1px solid #d1d1d1', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.max(0, activeRowIndex - 20))}>{lang === 'vi' ? '◄ Trước' : '◄ Prev'}</button>
          <button style={{ background: '#ffffff', border: '1px solid #d1d1d1', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.min(rows.length - 1, activeRowIndex + 20))}>{lang === 'vi' ? 'Sau ►' : 'Next ►'}</button>
          <span>{lang === 'vi' ? `Dòng: ${activeRowIndex + 1}/${rows.length}` : `Row: ${activeRowIndex + 1}/${rows.length}`}</span>
          <span>Ready</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  )
}

/* ================== VS CODE VIEW COMPONENT ================== */
function VsCodeView({
  rows,
  activeRowIndex,
  activeRowRef,
  onSelectRow,
  fontSize,
  panic,
  loading,
  curT,
  lang = 'vi',
}: SubViewProps) {
  const WINDOW_SIZE = 50
  const startIdx = Math.max(0, activeRowIndex - 15)
  const endIdx = Math.min(rows.length, startIdx + WINDOW_SIZE)
  const windowedRows = rows.slice(startIdx, endIdx)

  return (
    <div className="vscode-container">
      <div className="vscode-main">
        {/* Activity Bar */}
        <div className="vscode-activity-bar">
          <div className="vscode-activity-icon active" title="Explorer">📄</div>
          <div className="vscode-activity-icon" title="Search">🔍</div>
          <div className="vscode-activity-icon" title="Source Control">🌿</div>
          <div className="vscode-activity-icon" title="Run and Debug">▶</div>
          <div className="vscode-activity-icon" title="Extensions">🧩</div>
        </div>

        {/* Sidebar */}
        <div className="vscode-sidebar">
          <div className="vscode-sidebar-title">EXPLORER: NOCAP-CORE</div>
          <div className="vscode-tree-item">▼ src</div>
          <div className="vscode-tree-item" style={{ paddingLeft: '24px' }}>▶ controllers</div>
          <div className="vscode-tree-item" style={{ paddingLeft: '24px' }}>▼ pipeline</div>
          <div className="vscode-tree-item active" style={{ paddingLeft: '32px' }}>
            📄 analytics_stream.ts
          </div>
          <div className="vscode-tree-item" style={{ paddingLeft: '32px' }}>
            📄 data_model.schema.ts
          </div>
          <div className="vscode-tree-item" style={{ paddingLeft: '32px' }}>
            📄 telemetry_worker.ts
          </div>
          <div className="vscode-tree-item">▶ node_modules</div>
          <div className="vscode-tree-item">⚙️ tsconfig.json</div>
        </div>

        {/* Editor Area */}
        <div className="vscode-editor-area">
          {/* Tabs */}
          <div className="vscode-tabs-bar">
            <div className="vscode-tab active">
              <span style={{ color: '#569cd6' }}>TS</span> analytics_stream.ts
              <span style={{ marginLeft: '8px', opacity: 0.6 }}>✕</span>
            </div>
            <div className="vscode-tab">
              <span style={{ color: '#569cd6' }}>TS</span> telemetry_worker.ts
            </div>
          </div>

          {/* Breadcrumbs */}
          <div className="vscode-breadcrumbs">
            src &gt; pipeline &gt; analytics_stream.ts &gt; processTelemetryChunks()
          </div>

          {/* Code Scroll */}
          <div className="vscode-code-scroll" style={{ fontSize: `${fontSize}px` }}>
            {loading ? (
              <div style={{ padding: '24px', color: '#858585' }}>
                // Loading abstract syntax tree (AST)...
              </div>
            ) : (
              <>
                {startIdx > 0 && (
                  <div style={{ textAlign: 'center', padding: '6px', color: '#858585', fontSize: '11px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.max(0, activeRowIndex - 25))}>
                    {lang === 'vi'
                      ? `// ▲ Dòng ${startIdx + 1}. Bấm để cuộn lên...`
                      : `// ▲ Line ${startIdx + 1}. Click to scroll up...`}
                  </div>
                )}
                {windowedRows.map((row, offset) => {
                  const actualIndex = startIdx + offset
                  const isSelected = actualIndex === activeRowIndex
                  const lineNum = actualIndex * 6 + 1
                  return (
                    <div
                      key={`${actualIndex}-${row.id}`}
                      ref={isSelected ? (activeRowRef as React.RefObject<HTMLDivElement>) : null}
                      className={`vscode-line-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => onSelectRow(actualIndex)}
                    >
                      <div className="vscode-line-num">{lineNum}</div>
                      <div className="vscode-code-content">
                        <span className="vscode-comment">// [SEGMENT_{String(actualIndex + 1).padStart(4, '0')}] {row.category}</span>
                        <br />
                        <span className="vscode-keyword">export const </span>
                        <span className="vscode-var">CHUNK_{String(actualIndex + 1).padStart(4, '0')}</span> = &#123;
                        <br />
                        &nbsp;&nbsp;<span className="vscode-var">id: </span><span className="vscode-string">"{row.id}"</span>,
                        <br />
                        &nbsp;&nbsp;<span className="vscode-comment">/* &gt;&gt;&gt; READING LOG: */</span>
                        <br />
                        &nbsp;&nbsp;<span className="vscode-var">narrative: </span>
                        <span className="vscode-string">"{row.text}"</span>,
                        <br />
                        &nbsp;&nbsp;<span className="vscode-var">status: </span><span className="vscode-string">"{row.status}"</span>,
                        <br />
                        &nbsp;&nbsp;<span className="vscode-var">checksum: </span><span className="vscode-number">0x{((actualIndex * 41 + 17) % 65535).toString(16)}</span>
                        <br />
                        &#125;;
                      </div>
                    </div>
                  )
                })}
                {endIdx < rows.length && (
                  <div style={{ textAlign: 'center', padding: '6px', color: '#858585', fontSize: '11px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.min(rows.length - 1, activeRowIndex + 25))}>
                    {lang === 'vi'
                      ? `// ▼ Còn ${rows.length - endIdx} dòng tiếp theo. Bấm để xem tiếp...`
                      : `// ▼ ${rows.length - endIdx} more lines ahead. Click to load more...`}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Terminal at bottom */}
          <div className="vscode-terminal-panel">
            <div className="vscode-terminal-header">
              <span className="vscode-terminal-tab active">TERMINAL</span>
              <span>OUTPUT</span>
              <span>DEBUG CONSOLE</span>
              <span>PROBLEMS (0)</span>
            </div>
            <div>
              <span style={{ color: '#4ec9b0' }}>[vite:dev]</span> {curT.vscodeterminal}
              <br />
              <span style={{ color: '#858585' }}>&gt; worker thread active: telemetry_stream_0 (pid: 24108)</span>
            </div>
          </div>
        </div>
      </div>

      {/* VS Code Status bar */}
      <div className="vscode-statusbar">
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <span>🌿 main*</span>
          <span>⊗ 0  ▲ 0</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span>Ln {activeRowIndex + 1}/{rows.length}</span>
          <span>UTF-8</span>
          <span>TypeScript 5.8</span>
          <span>{panic ? 'EMERGENCY SHIELD ON' : 'PRETTIER: OK'}</span>
        </div>
      </div>
    </div>
  )
}

/* ================== TECHNICAL DOC / WORD VIEW COMPONENT ================== */
function DocView({
  bookTitle,
  rows,
  activeRowIndex,
  activeRowRef,
  onSelectRow,
  fontSize,
  panic,
  loading,
  curT,
  lang = 'vi',
}: SubViewProps & { bookTitle: string }) {
  const WINDOW_SIZE = 50
  const startIdx = Math.max(0, activeRowIndex - 15)
  const endIdx = Math.min(rows.length, startIdx + WINDOW_SIZE)
  const windowedRows = rows.slice(startIdx, endIdx)

  return (
    <div className="doc-container">
      <div className="doc-paper" style={{ fontSize: `${fontSize}px` }}>
        {/* Document Header */}
        <div className="doc-header-block">
          <div className="doc-confidential">
            {panic ? 'TOP SECRET • STRICTLY CONFIDENTIAL • INTERNAL AUDIT' : 'INTERNAL TECHNICAL SPECIFICATION • NOCAP-ARCH-2026'}
          </div>
          <h1 className="doc-main-title">
            {panic ? 'Enterprise Financial Governance & Risk Matrix Q4' : `Technical Reference: ${bookTitle}`}
          </h1>
          <div className="doc-meta">
            Document ID: DOC-2026-X84 • Revision: 3.12 • Classification: Internal Restricted
          </div>
        </div>

        {/* Paragraphs */}
        {loading ? (
          <p style={{ color: '#868e96' }}>Rendering compliance draft…</p>
        ) : (
          <>
            {startIdx > 0 && (
              <div style={{ textAlign: 'center', padding: '6px', color: '#868e96', fontSize: '11px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.max(0, activeRowIndex - 25))}>
                {lang === 'vi'
                  ? `▲ Đang hiển thị từ §${Math.floor(startIdx / 10) + 1}. Bấm để xem đoạn trước...`
                  : `▲ Showing from §${Math.floor(startIdx / 10) + 1}. Click to view earlier...`}
              </div>
            )}
            {windowedRows.map((row, offset) => {
              const actualIndex = startIdx + offset
              const isSelected = actualIndex === activeRowIndex
              const sectionNumber = `§${Math.floor(actualIndex / 10) + 1}.${(actualIndex % 10) + 1}`
              return (
                <div
                  key={`${actualIndex}-${row.id}`}
                  ref={isSelected ? (activeRowRef as React.RefObject<HTMLDivElement>) : null}
                  className={`doc-paragraph-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectRow(actualIndex)}
                >
                  <div className="doc-section-id">{sectionNumber}</div>
                  <div className="doc-text-body">{row.text}</div>
                </div>
              )
            })}
            {endIdx < rows.length && (
              <div style={{ textAlign: 'center', padding: '6px', color: '#868e96', fontSize: '11px', cursor: 'pointer' }} onClick={() => onSelectRow(Math.min(rows.length - 1, activeRowIndex + 25))}>
                {lang === 'vi'
                  ? `▼ Còn ${rows.length - endIdx} đoạn tiếp theo. Bấm để xem tiếp...`
                  : `▼ ${rows.length - endIdx} more sections ahead. Click to view more...`}
              </div>
            )}
          </>
        )}

        <div className="doc-meta" style={{ marginTop: '24px', borderTop: '1px solid #dee2e6', paddingTop: '8px' }}>
          {curT.keyboardGuide}
        </div>
      </div>
    </div>
  )
}

