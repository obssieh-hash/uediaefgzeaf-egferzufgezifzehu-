// Shared helpers for the ANSIE pages (reports, security dashboard, settings).
import request from '@/utils/request'

const PAGE_SIZE = 200

/**
 * Fetch every row of a paginated JumpServer list API, up to `max` rows.
 * Returns { rows, total, truncated }.
 */
export async function fetchAll(url, params = {}, max = 5000) {
  const rows = []
  let total = 0
  let offset = 0
  while (rows.length < max) {
    const limit = Math.min(PAGE_SIZE, max - rows.length)
    const res = await request.get(url, { params: { ...params, limit, offset } })
    if (Array.isArray(res)) {
      return { rows: res.slice(0, max), total: res.length, truncated: res.length > max }
    }
    const page = res?.results || []
    total = res?.count ?? page.length
    rows.push(...page)
    offset += page.length
    if (page.length < limit || rows.length >= total) {
      break
    }
  }
  return { rows, total, truncated: total > rows.length }
}

/** Number of rows matching a list API query, without downloading them. */
export async function countOf(url, params = {}) {
  const res = await request.get(url, { params: { ...params, limit: 1, offset: 0 } })
  if (Array.isArray(res)) return res.length
  return res?.count ?? 0
}

/** Display value of a JumpServer field that may be a {value, label} object. */
export function labelOf(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    return value.label ?? value.name ?? value.value ?? ''
  }
  return value
}

function csvCell(value) {
  let text = labelOf(value)
  text = text === null || text === undefined ? '' : String(text)
  // Neutralise spreadsheet formulas (CSV injection) and quote every cell.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }
  return `"${text.replace(/"/g, '""')}"`
}

/** Download `rows` as a UTF-8 CSV that opens correctly in Excel. */
export function downloadCsv(filename, columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(';')
  const lines = rows.map((row) =>
    columns.map((c) => csvCell(c.value ? c.value(row) : row[c.prop])).join(';')
  )
  const blob = new Blob(['﻿' + [header, ...lines].join('\r\n')], {
    type: 'text/csv;charset=utf-8'
  })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

export function formatDateTime(value) {
  if (!value) return ''
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export const WEEKDAYS = [
  { value: 1, short: 'Lun', label: 'lundi' },
  { value: 2, short: 'Mar', label: 'mardi' },
  { value: 3, short: 'Mer', label: 'mercredi' },
  { value: 4, short: 'Jeu', label: 'jeudi' },
  { value: 5, short: 'Ven', label: 'vendredi' },
  { value: 6, short: 'Sam', label: 'samedi' },
  { value: 7, short: 'Dim', label: 'dimanche' }
]
