import 'server-only';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { THEME } from '@/constants/theme';
import {
  buildTrend,
  formatCurrency,
  formatDate,
  formatNumber,
  round,
  sumInsights,
} from './utils';
import type { Campaign, Client, DailyInsight, ManualEntry } from '@/types';

/**
 * Report generation. Both formats are produced from the same
 * `ReportPayload` so the PDF and the CSV can never disagree.
 */

export interface ReportPayload {
  client: Pick<Client, 'id' | 'name' | 'primary_goal'>;
  range: { start: string; end: string };
  campaigns: Campaign[];
  insights: DailyInsight[];
  manualEntries?: ManualEntry[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ CSV */

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection on untrusted text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');

export function buildCsv(payload: ReportPayload): string {
  const { client, range, campaigns, insights, manualEntries = [] } = payload;
  const summary = sumInsights(insights);
  const lines: string[] = [];

  lines.push(csvRow(['Boldstep Performance Report']));
  lines.push(csvRow(['Client', client.name]));
  lines.push(csvRow(['Primary goal', client.primary_goal]));
  lines.push(csvRow(['Date range', `${range.start} to ${range.end}`]));
  lines.push(csvRow(['Generated at', payload.generatedAt]));
  lines.push('');

  lines.push(csvRow(['SUMMARY']));
  lines.push(csvRow(['Metric', 'Value']));
  lines.push(csvRow(['Total spend (RM)', round(summary.total_spend, 2)]));
  lines.push(csvRow(['Total leads', summary.total_leads]));
  lines.push(csvRow(['Total conversions', summary.total_conversions]));
  lines.push(csvRow(['Cost per lead (RM)', round(summary.avg_cpl, 2)]));
  lines.push(csvRow(['CTR (%)', round(summary.avg_ctr, 2)]));
  lines.push(csvRow(['CPM (RM)', round(summary.avg_cpm, 2)]));
  lines.push(csvRow(['CPC (RM)', round(summary.avg_cpc, 2)]));
  lines.push(csvRow(['Impressions', summary.total_impressions]));
  lines.push(csvRow(['Clicks', summary.total_clicks]));
  lines.push('');

  lines.push(csvRow(['CAMPAIGN BREAKDOWN']));
  lines.push(
    csvRow(['Campaign', 'Status', 'Objective', 'Daily budget (RM)', 'Spend (RM)', 'Leads', 'CPL (RM)', 'CTR (%)']),
  );
  for (const campaign of campaigns) {
    const rows = insights.filter((i) => i.campaign_id === campaign.id);
    const stats = sumInsights(rows);
    lines.push(
      csvRow([
        campaign.name,
        campaign.status,
        campaign.objective,
        round(campaign.budget_daily, 2),
        round(stats.total_spend, 2),
        stats.total_leads,
        round(stats.avg_cpl, 2),
        round(stats.avg_ctr, 2),
      ]),
    );
  }
  lines.push('');

  lines.push(csvRow(['DAILY DETAIL']));
  lines.push(
    csvRow(['Date', 'Campaign', 'Spend (RM)', 'Impressions', 'Clicks', 'Leads', 'Conversions', 'CTR (%)', 'CPM (RM)', 'CPC (RM)', 'CPL (RM)']),
  );
  for (const insight of [...insights].sort(
    (a, b) => a.date.localeCompare(b.date) || a.campaign_name.localeCompare(b.campaign_name),
  )) {
    lines.push(
      csvRow([
        insight.date,
        insight.campaign_name,
        round(insight.spend, 2),
        insight.impressions,
        insight.clicks,
        insight.leads,
        insight.conversions,
        round(insight.ctr, 2),
        round(insight.cpm, 2),
        round(insight.cpc, 2),
        round(insight.cpl, 2),
      ]),
    );
  }

  if (manualEntries.length > 0) {
    lines.push('');
    lines.push(csvRow(['MANUAL ENTRIES']));
    lines.push(csvRow(['Date', 'Campaign ID', 'Metric', 'Value', 'Entered by', 'Notes']));
    for (const entry of manualEntries) {
      lines.push(
        csvRow([
          entry.date,
          entry.campaign_id,
          entry.metric_type,
          entry.value,
          entry.entered_by,
          entry.notes,
        ]),
      );
    }
  }

  // BOM so Excel opens UTF-8 correctly.
  return `﻿${lines.join('\r\n')}`;
}

/* ------------------------------------------------------------------ PDF */

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
};

export function buildPdf(payload: ReportPayload): Buffer {
  const { client, range, campaigns, insights } = payload;
  const summary = sumInsights(insights);
  const trend = buildTrend(insights);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const navy = hexToRgb(THEME.colors.brandBlue);
  const cream = hexToRgb(THEME.colors.brandCream);

  /* header band */
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 96, 'F');
  doc.setTextColor(...cream);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('BOLDSTEP', 40, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Meta Ads Performance Report', 40, 64);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date(payload.generatedAt).toLocaleString('en-MY')}`, 40, 80);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(client.name, pageWidth - 40, 46, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${range.start}  to  ${range.end}`, pageWidth - 40, 64, { align: 'right' });
  doc.text(`Primary goal: ${client.primary_goal}`, pageWidth - 40, 78, { align: 'right' });

  /* KPI row */
  const kpis: [string, string][] = [
    ['Total Spend', formatCurrency(summary.total_spend)],
    ['Leads', formatNumber(summary.total_leads)],
    ['Cost / Lead', formatCurrency(summary.avg_cpl)],
    ['CTR', `${round(summary.avg_ctr, 2)}%`],
  ];
  const cardWidth = (pageWidth - 80 - 3 * 12) / 4;
  kpis.forEach(([label, value], index) => {
    const x = 40 + index * (cardWidth + 12);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(248, 247, 245);
    doc.roundedRect(x, 118, cardWidth, 58, 6, 6, 'FD');
    doc.setTextColor(110, 110, 110);
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), x + 12, 138);
    doc.setTextColor(...navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(value, x + 12, 160);
    doc.setFont('helvetica', 'normal');
  });

  /* campaign table */
  autoTable(doc, {
    startY: 196,
    head: [['Campaign', 'Status', 'Spend', 'Leads', 'CPL', 'CTR']],
    body: campaigns.map((campaign) => {
      const stats = sumInsights(insights.filter((i) => i.campaign_id === campaign.id));
      return [
        campaign.name,
        campaign.status,
        formatCurrency(stats.total_spend),
        formatNumber(stats.total_leads),
        formatCurrency(stats.avg_cpl),
        `${round(stats.avg_ctr, 2)}%`,
      ];
    }),
    styles: { fontSize: 9, cellPadding: 6, textColor: [40, 40, 40] },
    headStyles: { fillColor: navy, textColor: cream, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 247, 245] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        'boldstep.my — confidential client report',
        40,
        doc.internal.pageSize.getHeight() - 24,
      );
    },
  });

  /* daily table */
  const afterCampaigns = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  autoTable(doc, {
    startY: (afterCampaigns?.finalY ?? 300) + 28,
    head: [['Date', 'Spend', 'Impressions', 'Clicks', 'Leads', 'CPL', 'CTR']],
    body: trend.map((point) => [
      formatDate(point.date),
      formatCurrency(point.spend),
      formatNumber(point.impressions),
      formatNumber(point.clicks),
      formatNumber(point.leads),
      formatCurrency(point.cpl),
      `${round(point.ctr, 2)}%`,
    ]),
    styles: { fontSize: 8, cellPadding: 4, textColor: [40, 40, 40] },
    headStyles: { fillColor: navy, textColor: cream, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 247, 245] },
    margin: { left: 40, right: 40 },
  });

  return Buffer.from(doc.output('arraybuffer'));
}

export function reportFileName(clientId: string, range: { start: string; end: string }, ext: string) {
  return `boldstep-${clientId}-${range.start}_${range.end}.${ext}`;
}
