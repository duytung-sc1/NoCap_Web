import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlignCenter, AlignEndVertical, AlignLeft, AlignRight, AlignStartVertical, Bold,
  Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Copy, DollarSign,
  Eraser, FileSpreadsheet, Grid2X2, Grid3X3, IndentDecrease, IndentIncrease,
  Italic, ListFilter, Maximize2, MessageSquare, Minus, PaintBucket, Paintbrush,
  Percent, Plus, Redo2, Save, Scissors, Search, Share2, Sigma, Square,
  Table2, Underline, Undo2, WrapText, X,
} from 'lucide-react'
import type { Lang } from '../i18n'
import type { StealthTranslations } from './StealthReader'
import type { StealthRow } from './textExtractor'
import { findWorksheetCell, WORKSHEET_COLUMNS, worksheetCellValue, worksheetRowNumber, type WorksheetColumn } from './worksheet'

interface Props {
  rows: StealthRow[]
  currentRow: StealthRow
  activeRowIndex: number
  activeRowRef: RefObject<HTMLTableRowElement | HTMLDivElement | null>
  onSelectRow: (index: number) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  panic: boolean
  loading: boolean
  curT: StealthTranslations
  lang?: Lang
  search: string
  onSearchChange: (value: string) => void
  onOpenSettings: () => void
  onToggleFullscreen: () => void
  onClose: () => void
  fullscreen: boolean
}

function RibbonButton({ icon, label, onClick, selected, disabled, large, children }: {
  icon: ReactNode; label: string; onClick?: () => void; selected?: boolean
  disabled?: boolean; large?: boolean; children?: ReactNode
}) {
  return <button type="button" className={`excel-command ${large ? 'large' : ''} ${selected ? 'chosen' : ''}`}
    aria-label={label} title={label} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    {icon}{children && <span>{children}</span>}
  </button>
}

const FIELD_LABELS = ['Record ID', 'KPI category', 'Management commentary', 'Status', 'Variance', '', '', '', '']
const CELL_CLASSES = ['id-col', 'cat-col', 'text-col', 'status-col', 'var-col', '', '', '', '']

export function ExcelView({ rows, currentRow, activeRowIndex, activeRowRef, onSelectRow, fontSize,
  onFontSizeChange, panic, loading, curT, lang = 'vi', search, onSearchChange, onOpenSettings,
  onToggleFullscreen, onClose, fullscreen }: Props) {
  const [column, setColumn] = useState<WorksheetColumn>('C')
  const [fontFamily, setFontFamily] = useState('Calibri')
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [underline, setUnderline] = useState(false)
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('left')
  const [wrap, setWrap] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [clipboardStatus, setClipboardStatus] = useState('')
  const [horizontalMax, setHorizontalMax] = useState(0)
  const [horizontalPosition, setHorizontalPosition] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const windowSize = 70
  const start = Math.max(0, activeRowIndex - 20)
  const end = Math.min(rows.length, start + windowSize)
  const address = `${column}${worksheetRowNumber(currentRow)}`
  const cellValue = worksheetCellValue(currentRow, column)

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [fontSize, fontFamily, bold, italic, underline, alignment, wrap, zoom, activeRowRef])

  useEffect(() => {
    const grid = gridRef.current
    const table = tableRef.current
    if (!grid || !table) return
    const measure = () => {
      setHorizontalMax(Math.max(0, grid.scrollWidth - grid.clientWidth))
      setHorizontalPosition(grid.scrollLeft)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    observer.observe(table)
    measure()
    return () => observer.disconnect()
  }, [loading])

  useEffect(() => {
    if (!clipboardStatus) return
    const timer = window.setTimeout(() => setClipboardStatus(''), 2000)
    return () => window.clearTimeout(timer)
  }, [clipboardStatus])

  const resetFormatting = () => {
    setFontFamily('Calibri'); onFontSizeChange(12); setBold(false); setItalic(false)
    setUnderline(false); setAlignment('left'); setWrap(true)
  }

  const copyCell = () => {
    if (!navigator.clipboard) { setClipboardStatus('Copy unavailable'); return }
    void navigator.clipboard.writeText(cellValue).then(() => setClipboardStatus('Copied')).catch(() => setClipboardStatus('Copy unavailable'))
  }

  const selectCell = (nextColumn: WorksheetColumn, index: number) => {
    setColumn(nextColumn)
    onSelectRow(index)
  }

  return <div className="excel-container">
    <div className="excel-titlebar">
      <div className="excel-title-left">
        <FileSpreadsheet className="excel-app-mark" aria-hidden="true" />
        <span className="excel-autosave">AutoSave <span className="excel-auto-switch" aria-hidden="true">On<span /></span></span>
        <div className="excel-quick-access" aria-hidden="true"><Save /><Undo2 /><ChevronDown /><Redo2 /></div>
        <span className="excel-filename">Q4_Consolidated_Financial_Model.xlsx <ChevronDown /><span className="excel-saved-indicator"><Check />Saved</span></span>
      </div>
      <label className="excel-workbook-search"><Search aria-hidden="true" /><input ref={searchRef} data-stealth-search
        aria-label={curT.searchPrompt} placeholder="Search" value={panic ? '' : search} readOnly={panic}
        onChange={event => { if (!panic) onSearchChange(event.target.value) }} /></label>
      <div className="excel-window-controls">
        <span className="excel-window-decoration" aria-hidden="true"><Minus /></span>
        <button type="button" onClick={onToggleFullscreen} title={fullscreen ? curT.exitFullscreenLabel : curT.fullscreenLabel}
          aria-label={fullscreen ? curT.exitFullscreenLabel : curT.fullscreenLabel}>{fullscreen ? <Copy /> : <Square />}</button>
        <button type="button" className="excel-close-window" onClick={onClose} title={curT.exitStealth} aria-label={curT.exitStealth}><X /></button>
      </div>
    </div>

    <div className="excel-ribbon-tabs">
      <button type="button" className="excel-ribbon-tab excel-file-tab" onClick={onOpenSettings}>File</button>
      <span className="excel-ribbon-tab active">Home</span>
      {['Insert', 'Draw', 'Page Layout', 'Formulas', 'Data', 'Review'].map(tab => <span className="excel-ribbon-tab" key={tab}>{tab}</span>)}
      <button type="button" className="excel-ribbon-tab" onClick={onOpenSettings}>View</button>
      <span className="excel-ribbon-tab">Help</span>
      <span className="excel-ribbon-tab">Automate</span>
      <div className="excel-collaboration" aria-hidden="true"><span><MessageSquare />Comments</span><span className="excel-share"><Share2 />Share<ChevronDown /></span></div>
    </div>

    <div className="excel-ribbon-tools">
      <div className="excel-ribbon-group clipboard-group">
        <div className="excel-ribbon-content">
          <RibbonButton icon={<Clipboard className="excel-paste-icon" />} label="Paste (read-only workbook)" large disabled>Paste<ChevronDown /></RibbonButton>
          <div className="excel-command-stack">
            <RibbonButton icon={<Scissors />} label="Cut (read-only workbook)" disabled>Cut</RibbonButton>
            <RibbonButton icon={<Copy />} label="Copy" onClick={copyCell}>Copy<ChevronDown /></RibbonButton>
            <RibbonButton icon={<Paintbrush />} label="Format Painter (read-only workbook)" disabled>Format Painter</RibbonButton>
          </div>
        </div><span className="excel-group-caption">Clipboard</span>
      </div>

      <div className="excel-ribbon-group font-group">
        <div className="excel-font-controls">
          <div className="excel-command-row">
            <select className="excel-font-select" aria-label="Font" value={fontFamily} onChange={event => setFontFamily(event.target.value)}>
              <option>Calibri</option><option>Aptos</option><option>Arial</option><option>Segoe UI</option>
            </select>
            <select className="excel-size-select" aria-label={curT.fontSizeLabel} value={fontSize} onChange={event => onFontSizeChange(Number(event.target.value))}>
              {[10, 11, 12, 13, 14, 15, 16].map(size => <option key={size}>{size}</option>)}
            </select>
            <RibbonButton icon={<span className="excel-grow-font">A<sup>⌃</sup></span>} label="Increase Font Size" onClick={() => onFontSizeChange(Math.min(16, fontSize + 1))} />
            <RibbonButton icon={<span className="excel-shrink-font">A<sup>⌄</sup></span>} label="Decrease Font Size" onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))} />
          </div>
          <div className="excel-command-row">
            <RibbonButton icon={<Bold />} label="Bold" selected={bold} onClick={() => setBold(previous => !previous)} />
            <RibbonButton icon={<Italic />} label="Italic" selected={italic} onClick={() => setItalic(previous => !previous)} />
            <RibbonButton icon={<Underline />} label="Underline" selected={underline} onClick={() => setUnderline(previous => !previous)} />
            <span className="excel-command-divider" />
            <span className="excel-static-command" aria-hidden="true"><Grid2X2 /><ChevronDown /></span>
            <span className="excel-static-command excel-fill-color" aria-hidden="true"><PaintBucket /><ChevronDown /></span>
            <span className="excel-static-command excel-font-color" aria-hidden="true"><span>A</span><ChevronDown /></span>
          </div>
        </div><span className="excel-group-caption">Font<button type="button" onClick={onOpenSettings} aria-label="Font settings">↘</button></span>
      </div>

      <div className="excel-ribbon-group alignment-group">
        <div className="excel-font-controls">
          <div className="excel-command-row">
            <span className="excel-static-command" aria-hidden="true"><AlignStartVertical /></span>
            <span className="excel-static-command" aria-hidden="true"><AlignEndVertical /></span>
            <span className="excel-static-command" aria-hidden="true">ab↗</span>
            <RibbonButton icon={<WrapText />} label="Wrap Text" selected={wrap} onClick={() => setWrap(previous => !previous)}>Wrap Text</RibbonButton>
          </div>
          <div className="excel-command-row">
            <RibbonButton icon={<AlignLeft />} label="Align Left" selected={alignment === 'left'} onClick={() => setAlignment('left')} />
            <RibbonButton icon={<AlignCenter />} label="Center" selected={alignment === 'center'} onClick={() => setAlignment('center')} />
            <RibbonButton icon={<AlignRight />} label="Align Right" selected={alignment === 'right'} onClick={() => setAlignment('right')} />
            <span className="excel-static-command" aria-hidden="true"><IndentDecrease /><IndentIncrease /></span>
            <span className="excel-static-command excel-merge-label" aria-hidden="true"><Table2 />Merge & Center<ChevronDown /></span>
          </div>
        </div><span className="excel-group-caption">Alignment</span>
      </div>

      <div className="excel-ribbon-group number-group">
        <div className="excel-font-controls">
          <div className="excel-number-format">General<ChevronDown /></div>
          <div className="excel-command-row" aria-hidden="true"><span className="excel-static-command"><DollarSign /><ChevronDown /></span><span className="excel-static-command"><Percent /></span><span className="excel-static-command">,</span><span className="excel-command-divider" /><span className="excel-decimal">←.00</span><span className="excel-decimal">.0→</span></div>
        </div><span className="excel-group-caption">Number</span>
      </div>

      <div className="excel-ribbon-group styles-group">
        <div className="excel-ribbon-content" aria-hidden="true">
          <span className="excel-static-large"><Grid3X3 className="excel-conditional-icon" /><span>Conditional<br />Formatting<ChevronDown /></span></span>
          <span className="excel-static-large"><Table2 className="excel-table-icon" /><span>Format as<br />Table<ChevronDown /></span></span>
          <span className="excel-static-large"><span className="excel-cell-styles">Aa</span><span>Cell<br />Styles<ChevronDown /></span></span>
        </div><span className="excel-group-caption">Styles</span>
      </div>

      <div className="excel-ribbon-group cells-group">
        <div className="excel-command-stack" aria-hidden="true"><span className="excel-static-command"><Table2 />Insert<ChevronDown /></span><span className="excel-static-command"><Grid2X2 />Delete<ChevronDown /></span><span className="excel-static-command"><Table2 />Format<ChevronDown /></span></div>
        <span className="excel-group-caption">Cells</span>
      </div>

      <div className="excel-ribbon-group editing-group">
        <div className="excel-ribbon-content">
          <div className="excel-command-stack">
            <span className="excel-static-command" aria-hidden="true"><Sigma />AutoSum<ChevronDown /></span>
            <span className="excel-static-command" aria-hidden="true"><Table2 />Fill<ChevronDown /></span>
            <RibbonButton icon={<Eraser />} label="Clear Formatting" onClick={resetFormatting}>Clear<ChevronDown /></RibbonButton>
          </div>
          <span className="excel-static-large excel-sort-command" aria-hidden="true"><ListFilter /><span>Sort &<br />Filter<ChevronDown /></span></span>
          <RibbonButton icon={<Search />} label="Find & Select" large onClick={() => searchRef.current?.focus()}>Find &<br />Select<ChevronDown /></RibbonButton>
        </div><span className="excel-group-caption">Editing</span>
      </div>
    </div>

    <div className="excel-formula-bar">
      <label className="excel-name-box"><input aria-label={lang === 'vi' ? 'Địa chỉ ô' : 'Cell address'} value={nameEditing ? nameDraft : address}
        onFocus={() => { setNameDraft(address); setNameEditing(true) }} onChange={event => setNameDraft(event.target.value)} onBlur={() => setNameEditing(false)}
        onKeyDown={event => { if (event.key !== 'Enter') return; event.preventDefault(); const cell = findWorksheetCell(nameDraft, rows); if (cell) selectCell(cell.column, cell.displayIndex); event.currentTarget.blur(); event.currentTarget.closest<HTMLElement>('.stealth-wrapper')?.focus({ preventScroll: true }) }} /><ChevronDown aria-hidden="true" /></label>
      <span className="excel-formula-controls" aria-hidden="true"><X /><Check /><i>fx</i><ChevronDown /></span>
      <div className="excel-formula-input" title={cellValue}>{cellValue}</div><ChevronDown className="excel-formula-expand" aria-hidden="true" />
    </div>

    <div ref={gridRef} className="excel-grid-container" onScroll={event => setHorizontalPosition(event.currentTarget.scrollLeft)}>
      <table ref={tableRef} className={`excel-table ${wrap ? '' : 'no-wrap'}`} style={{ fontSize: `${fontSize}px`, fontFamily: `${fontFamily}, 'Segoe UI', Arial, sans-serif`, zoom: zoom / 100 }}>
        <colgroup><col className="excel-number-column" /><col className="excel-id-column" /><col className="excel-category-column" /><col /><col className="excel-status-column" /><col className="excel-variance-column" />{['F', 'G', 'H', 'I'].map(key => <col className="excel-empty-column" key={key} />)}</colgroup>
        <thead><tr><th className="excel-th excel-corner" aria-label="Worksheet"><span /></th>{WORKSHEET_COLUMNS.map(key => <th key={key} scope="col" className={`excel-th ${column === key ? 'selected' : ''}`}>{key}</th>)}</tr></thead>
        <tbody>
          <tr className="excel-field-row"><th className="excel-row-num" scope="row">1</th>{FIELD_LABELS.map((label, index) => <td className="excel-td" key={index}>{label}</td>)}</tr>
          {loading ? <tr><th className="excel-row-num">2</th><td className="excel-td" colSpan={9}>Loading workbook…</td></tr> : <>
            {rows.slice(start, end).map((row, offset) => {
              const index = start + offset
              const selected = index === activeRowIndex
              return <tr key={`${index}-${row.id}`} className={`excel-tr ${selected ? 'selected' : ''}`} ref={selected ? activeRowRef as RefObject<HTMLTableRowElement> : null}>
                <th className="excel-row-num" scope="row" onClick={() => selectCell('C', index)}>{worksheetRowNumber(row)}</th>
                {WORKSHEET_COLUMNS.map((key, cellIndex) => <td key={key} className={`excel-td ${CELL_CLASSES[cellIndex]} ${selected && column === key ? 'selected-cell' : ''}`}
                  style={key === 'C' ? { fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', textAlign: alignment } : undefined}
                  onClick={() => selectCell(key, index)}>{worksheetCellValue(row, key)}</td>)}
              </tr>
            })}
            {/* Empty worksheet cells extend below the data without changing book progress. */}
            {end === rows.length && Array.from({ length: 40 }, (_, offset) => <tr className="excel-empty-row" key={`empty-${offset}`}><th className="excel-row-num" scope="row">{(rows.at(-1) ? worksheetRowNumber(rows.at(-1)!) : 1) + offset + 1}</th>{WORKSHEET_COLUMNS.map(key => <td className="excel-td" key={key} />)}</tr>)}
          </>}
        </tbody>
      </table>
    </div>

    <div className="excel-footer-tabs">
      <div className="excel-sheet-navigation"><button type="button" aria-label="Scroll sheet tabs left" onClick={() => tabsRef.current?.scrollBy({ left: -180, behavior: 'smooth' })}><ChevronLeft /></button><button type="button" aria-label="Scroll sheet tabs right" onClick={() => tabsRef.current?.scrollBy({ left: 180, behavior: 'smooth' })}><ChevronRight /></button><span aria-hidden="true">···</span></div>
      <div ref={tabsRef} className="excel-tabs-list"><span className="excel-sheet-tab active">{curT.excelSheetMain}</span><span className="excel-sheet-tab">{curT.excelSheetAudit}</span><span className="excel-sheet-tab">{curT.excelSheetMetrics}</span><span className="excel-new-sheet" aria-hidden="true"><Plus /></span></div>
      <input className="excel-horizontal-scroll" type="range" min="0" max={horizontalMax} value={horizontalPosition} disabled={!horizontalMax} aria-label="Horizontal scroll"
        onChange={event => { if (gridRef.current) gridRef.current.scrollLeft = Number(event.target.value) }} />
    </div>
    <div className="excel-statusbar"><span>{clipboardStatus || 'Ready'}</span><span className="excel-accessibility"><Check />Accessibility: Good to go</span>
      <div className="excel-status-right"><span className="excel-sheet-views" aria-hidden="true"><Grid2X2 className="active" /><FileSpreadsheet /><Table2 /></span>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(previous => Math.max(50, previous - 10))}><Minus /></button>
        <input type="range" min="50" max="200" step="10" value={zoom} aria-label="Zoom" onChange={event => setZoom(Number(event.target.value))} />
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(previous => Math.min(200, previous + 10))}><Plus /></button>
        <button type="button" className="excel-zoom-value" title="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
        <Maximize2 aria-hidden="true" />
      </div>
    </div>
  </div>
}
