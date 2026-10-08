import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '../types'
import { t, type Lang } from '../i18n'
import {
  extractBookRows,
  PANIC_CORPORATE_ROWS,
  type StealthRow
} from './textExtractor'
import {
  buildDisplayEntries,
  displayIndexForSource,
  progressionFromRowIndex,
  rowIndexFromLocator,
  sourceIndexForDisplay,
} from './navigation'
import './StealthReader.css'
import { stealthShortcut } from './shortcuts'
import { DisguiseFullscreen } from './fullscreen'

export type DisguiseMode = 'excel' | 'vscode' | 'doc'

export interface StealthPosition {
  progression: number
  sourceHref?: string
}

interface Props {
  book: Book
  bytes: ArrayBuffer
  lang: Lang
  initialProgression?: number
  initialLocator?: string
  onClose: (position?: StealthPosition) => void
  onExitHome?: () => void
  onProgressChange?: (position: StealthPosition) => void
}

export function StealthReader({
  book,
  bytes,
  lang,
  initialProgression = 0,
  initialLocator,
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
  const [helpOpen, setHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDialogElement>(null)
  const fullscreenRef = useRef<DisguiseFullscreen | null>(null)
  const activeRowRef = useRef<HTMLTableRowElement | HTMLDivElement | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialProgressionRef = useRef(initialProgression)
  const initialLocatorRef = useRef(initialLocator)
  const progressChangedRef = useRef(false)
  const onProgressChangeRef = useRef(onProgressChange)
  useEffect(() => { onProgressChangeRef.current = onProgressChange }, [onProgressChange])
  useEffect(() => { initialProgressionRef.current = initialProgression }, [initialProgression])
  useEffect(() => { initialLocatorRef.current = initialLocator }, [initialLocator])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const controller = new DisguiseFullscreen(wrapper, document)
    fullscreenRef.current = controller
    const update = () => setFullscreen(controller.active)
    document.addEventListener('fullscreenchange', update)
    wrapper.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('fullscreenchange', update)
      fullscreenRef.current = null
      controller.dispose()
    }
  }, [])

  useEffect(() => {
    const originalTitle = document.title
    const title = mode === 'excel' ? 'Q4_Consolidated_Financial_Model_v4.2.xlsx — Excel'
      : mode === 'vscode' ? 'analytics_stream.ts — Visual Studio Code' : 'Enterprise Data Pipeline Reference — Word'
    document.title = title
    return () => { if (document.title === title) document.title = originalTitle }
  }, [mode])

  useEffect(() => {
    const dialog = settingsRef.current
    if (!dialog) return
    if (helpOpen && !dialog.open) dialog.showModal()
    if (!helpOpen && dialog.open) {
      dialog.close()
      wrapperRef.current?.focus({ preventScroll: true })
    }
  }, [helpOpen])

  const toggleFullscreen = useCallback(() => {
    const controller = fullscreenRef.current
    if (!controller) return
    setFullscreenError(false)
    // Called directly from a click/keydown so the browser receives user activation.
    void controller.toggle().then(success => {
      if (fullscreenRef.current === controller && !success) { setFullscreenError(true); setHelpOpen(true) }
    }).catch(() => {
      if (fullscreenRef.current === controller) { setFullscreenError(true); setHelpOpen(true) }
    })
  }, [])

  const exitFullscreen = useCallback(() => {
    void fullscreenRef.current?.exit().catch(() => { /* Native Escape may already have exited. */ })
  }, [])

  // Extract text on mount
  useEffect(() => {
    let alive = true

    void (async () => {
      try {
        const extracted = await extractBookRows(book, bytes)
        if (!alive) return
        setRows(extracted)
        setActiveRowIndex(rowIndexFromLocator(extracted, initialLocatorRef.current, initialProgressionRef.current))
        progressChangedRef.current = false
      } catch {
        if (!alive) return
        setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => { alive = false }
  }, [book, bytes])

  // Filtered rows
  const displayEntries = useMemo(() => {
    return buildDisplayEntries(rows, search, PANIC_CORPORATE_ROWS, panic)
  }, [panic, rows, search])
  const displayRows = useMemo(() => displayEntries.map(entry => entry.row), [displayEntries])
  const displayActiveRowIndex = displayIndexForSource(displayEntries, activeRowIndex)

  // Active row data
  const currentRow = displayRows[displayActiveRowIndex] || displayRows[0] || {
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
    if (panic || !rows.length || !progressChangedRef.current) return
    onProgressChangeRef.current?.({
      progression: progressionFromRowIndex(activeRowIndex, rows.length),
      sourceHref: rows[activeRowIndex]?.sourceHref,
    })
  }, [activeRowIndex, rows, panic])

  const selectDisplayRow = useCallback((displayIndex: number) => {
    setActiveRowIndex(previous => {
      const sourceIndex = sourceIndexForDisplay(displayEntries, displayIndex, previous)
      if (sourceIndex !== previous) progressChangedRef.current = true
      return sourceIndex
    })
  }, [displayEntries])

  const moveDisplayRow = useCallback((delta: number) => {
    if (panic || displayEntries.length === 0) return
    setActiveRowIndex(previous => {
      const currentDisplayIndex = displayIndexForSource(displayEntries, previous)
      const targetDisplayIndex = Math.min(displayEntries.length - 1, Math.max(0, currentDisplayIndex + delta))
      const sourceIndex = sourceIndexForDisplay(displayEntries, targetDisplayIndex, previous)
      if (sourceIndex !== previous) progressChangedRef.current = true
      return sourceIndex
    })
  }, [displayEntries, panic])

  const closeStealth = useCallback(() => {
    const position = progressChangedRef.current
      ? {
          progression: progressionFromRowIndex(activeRowIndex, rows.length),
          sourceHref: rows[activeRowIndex]?.sourceHref,
        }
      : undefined
    onClose(position)
  }, [activeRowIndex, onClose, rows])

  const togglePanic = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setHelpOpen(false)
    setOpacity(1)
    setPanic(previous => !previous)
  }, [])

  // Keyboard navigation & Boss Key hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const action = stealthShortcut({
        key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        shiftKey: e.shiftKey, repeat: e.repeat,
        editing: !!target?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"]'),
        helpOpen, panic, fullscreen: !!fullscreenRef.current?.active,
      })
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'panic': togglePanic(); break
        case 'close': closeStealth(); break
        case 'home': if (onExitHome) onExitHome(); else closeStealth(); break
        case 'help': setHelpOpen(previous => !previous); break
        case 'dismiss-help': setHelpOpen(false); break
        case 'fullscreen': toggleFullscreen(); break
        case 'exit-fullscreen': exitFullscreen(); break
        case 'clear-search': target?.blur(); setSearch(''); break
        case 'mode': setMode(action.mode); break
        case 'auto-scroll': setAutoScroll(previous => !previous); break
        case 'move': moveDisplayRow(action.delta); break
        case 'font-size': setFontSize(previous => Math.min(16, Math.max(10, previous + action.delta))); break
        case 'scroll-speed': setAutoScrollSpeed(previous => Math.min(20, Math.max(2, previous + action.delta))); break
        case 'opacity': setOpacity(previous => Math.min(1, Math.max(0.1, Math.round((previous + action.delta) * 100) / 100))); break
        case 'consume': break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeStealth, moveDisplayRow, onExitHome, panic, helpOpen, togglePanic, toggleFullscreen, exitFullscreen])

  // Auto-advance rows
  useEffect(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current)
      autoScrollTimer.current = null
    }

    if (autoScroll && !panic && !helpOpen && displayEntries.length > 0) {
      autoScrollTimer.current = setInterval(() => {
        setActiveRowIndex(previous => {
          const currentDisplayIndex = displayIndexForSource(displayEntries, previous)
          if (currentDisplayIndex >= displayEntries.length - 1) {
            setAutoScroll(false)
            return previous
          }
          const sourceIndex = sourceIndexForDisplay(displayEntries, currentDisplayIndex + 1, previous)
          if (sourceIndex !== previous) progressChangedRef.current = true
          return sourceIndex
        })
      }, autoScrollSpeed * 1000)
    }

    return () => {
      if (autoScrollTimer.current) clearInterval(autoScrollTimer.current)
    }
  }, [autoScroll, autoScrollSpeed, panic, helpOpen, displayEntries])

  // Auto-scroll the active row into viewport
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'nearest'
      })
    }
  }, [displayActiveRowIndex, mode, panic, fullscreen])

  return (
    <div ref={wrapperRef} className="stealth-wrapper" style={{ opacity }} tabIndex={-1}>
      {/* Settings are absent from the default view; F1 or the native View menu opens them. */}
      <dialog ref={settingsRef} className="stealth-settings" aria-labelledby="stealth-settings-title"
        onCancel={event => { event.preventDefault(); if (fullscreenRef.current?.active) exitFullscreen(); else setHelpOpen(false) }}>
        <div className="stealth-settings-heading">
          <h2 id="stealth-settings-title">{curT.settingsTitle}</h2>
          <button type="button" onClick={() => setHelpOpen(false)} aria-label={curT.dismissSettings}>×</button>
        </div>
        <p>{curT.keyboardGuide}</p>
        <dl className="stealth-shortcut-list">
          <div><dt><kbd>F10</kbd> / <kbd>Alt + F</kbd></dt><dd>{curT.fullscreenLabel}</dd></div>
          <div><dt><kbd>F2</kbd></dt><dd>{curT.exitStealth}</dd></div>
          <div><dt><kbd>F12</kbd> / <kbd>Alt + P</kbd></dt><dd>{curT.panicHelp}</dd></div>
          <div><dt><kbd>Alt + 1 / 2 / 3</kbd></dt><dd>Excel / VS Code / Word</dd></div>
          <div><dt><kbd>↑ / ↓ / Space</kbd></dt><dd>{curT.rowNavigation}</dd></div>
          <div><dt><kbd>Page Up / Page Down</kbd></dt><dd>{curT.pageNavigation}</dd></div>
          <div><dt><kbd>Alt + A</kbd></dt><dd>{curT.autoScroll}</dd></div>
          <div><dt><kbd>Alt + ← / →</kbd></dt><dd>{curT.speedHelp}</dd></div>
          <div><dt><kbd>Alt + ↑ / ↓</kbd></dt><dd>{curT.fontSizeLabel}</dd></div>
          <div><dt><kbd>Alt + [ / ]</kbd></dt><dd>{curT.opacityLabel}</dd></div>
          <div><dt><kbd>F1</kbd></dt><dd>{curT.settingsTitle}</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>{curT.escapeHelp}</dd></div>
        </dl>
        <div className="stealth-settings-fields">
          <label>{curT.disguiseLabel}<select value={mode} onChange={event => setMode(event.target.value as DisguiseMode)}>
            <option value="excel">Excel</option><option value="vscode">VS Code</option><option value="doc">Word</option>
          </select></label>
          <label className="stealth-settings-checkbox"><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />{curT.autoScroll}</label>
          <label>{curT.autoScrollSpeed} ({autoScrollSpeed}s)<input type="range" min="2" max="20" value={autoScrollSpeed} onChange={event => setAutoScrollSpeed(Number(event.target.value))} /></label>
          <label>{curT.fontSizeLabel}: {fontSize}px<input type="range" min="10" max="16" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></label>
          <label>{curT.opacityLabel}: {Math.round(opacity * 100)}%<input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>
        </div>
        {fullscreenError && <p role="alert">{curT.fullscreenUnavailable}</p>}
        <div className="stealth-settings-actions">
          <button type="button" onClick={toggleFullscreen}>{fullscreen ? curT.exitFullscreenLabel : curT.fullscreenLabel} (F10)</button>
          <button type="button" onClick={closeStealth}>{curT.exitStealth}</button>
          <button type="button" onClick={() => { if (onExitHome) onExitHome(); else closeStealth() }}>{curT.exitHome}</button>
          <button type="button" onClick={() => setHelpOpen(false)}>{curT.dismissSettings}</button>
        </div>
      </dialog>

      {/* Main Disguised View */}
      {mode === 'excel' && (
        <ExcelView
          rows={displayRows}
          currentRow={currentRow}
          activeRowIndex={displayActiveRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={selectDisplayRow}
          fontSize={fontSize}
          panic={panic}
          loading={loading}
          curT={curT}
          lang={lang}
          search={search}
          onSearchChange={setSearch}
          onFontSizeChange={setFontSize}
          onOpenSettings={() => setHelpOpen(true)}
        />
      )}

      {mode === 'vscode' && (
        <VsCodeView
          onOpenSettings={() => setHelpOpen(true)}
          rows={displayRows}
          activeRowIndex={displayActiveRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={selectDisplayRow}
          fontSize={fontSize}
          panic={panic}
          loading={loading}
          curT={curT}
          lang={lang}
        />
      )}

      {mode === 'doc' && (
        <DocView
          rows={displayRows}
          activeRowIndex={displayActiveRowIndex}
          activeRowRef={activeRowRef}
          onSelectRow={selectDisplayRow}
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
  settingsTitle: string
  dismissSettings: string
  fullscreenLabel: string
  exitFullscreenLabel: string
  fullscreenUnavailable: string
  panicHelp: string
  rowNavigation: string
  pageNavigation: string
  speedHelp: string
  escapeHelp: string
  disguiseLabel: string
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
  onFontSizeChange,
  onOpenSettings,
}: SubViewProps & {
  currentRow: StealthRow
  search: string
  onSearchChange: (val: string) => void
  onFontSizeChange: (size: number) => void
  onOpenSettings: () => void
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
          {panic ? 'Protected View' : `Row ${activeRowIndex + 1} of ${rows.length}`}
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
        <button type="button" className="excel-ribbon-tab" onClick={onOpenSettings}>View</button>
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
          <select className="excel-font-select" aria-label={curT.fontSizeLabel} value={fontSize} onChange={event => onFontSizeChange(Number(event.target.value))}>
            <option value="10">10</option>
            <option value="11">11</option>
            <option value="12">12</option>
            <option value="13">13</option>
            <option value="14">14</option>
            <option value="15">15</option>
            <option value="16">16</option>
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
            value={panic ? '' : search}
            readOnly={panic}
            onChange={e => { if (!panic) onSearchChange(e.target.value) }}
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
  onOpenSettings,
  rows,
  activeRowIndex,
  activeRowRef,
  onSelectRow,
  fontSize,
  loading,
  curT,
  lang = 'vi',
}: SubViewProps & { onOpenSettings: () => void }) {
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
          <button type="button" className="vscode-activity-settings" onClick={onOpenSettings} aria-label={curT.settingsTitle} title="Manage">⚙</button>
        </div>

        {/* Sidebar */}
        <div className="vscode-sidebar">
          <div className="vscode-sidebar-title">EXPLORER: ANALYTICS-CORE</div>
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
                        &nbsp;&nbsp;<span className="vscode-comment">/* &gt;&gt;&gt; ANALYTICS PAYLOAD: */</span>
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
          <span>PRETTIER: OK</span>
        </div>
      </div>
    </div>
  )
}

/* ================== TECHNICAL DOC / WORD VIEW COMPONENT ================== */
function DocView({
  rows,
  activeRowIndex,
  activeRowRef,
  onSelectRow,
  fontSize,
  panic,
  loading,
  lang = 'vi',
}: SubViewProps) {
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
            {panic ? 'TOP SECRET • STRICTLY CONFIDENTIAL • INTERNAL AUDIT' : 'INTERNAL TECHNICAL SPECIFICATION • DATA-ARCH-2026'}
          </div>
          <h1 className="doc-main-title">
            {panic ? 'Enterprise Financial Governance & Risk Matrix Q4' : 'Enterprise Data Pipeline Reference'}
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

      </div>
    </div>
  )
}
