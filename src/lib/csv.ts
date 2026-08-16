import { NextResponse } from 'next/server';

/** Serialises flat rows to a CSV download response (used by the export API). */
export function csvResponse(rows: Record<string, unknown>[], fileName: string): NextResponse {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    // Neutralise spreadsheet formula injection.
    const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const body =
    rows.length === 0
      ? ''
      : [
          headers.map(escape).join(','),
          ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
        ].join('\r\n');

  // BOM so Excel reads UTF-8 correctly.
  return new NextResponse(`﻿${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
