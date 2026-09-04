import { jsPDF } from 'jspdf';
import type { SalesQuoteSnapshot } from '../types';
import { humanModality } from './salesFlow';

const INK: [number, number, number] = [25, 25, 23];
const MUTED: [number, number, number] = [108, 104, 98];
const LINE: [number, number, number] = [222, 218, 210];
const PAPER: [number, number, number] = [248, 247, 244];
const ACCENT: [number, number, number] = [143, 126, 106];

const money = (value: unknown) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

function cleanCommercialName(value: unknown) {
  const raw = String(value || 'Experiencia').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return raw
    .replace(/\s*[([]?\b(PRUEBA|TEST|DEMO|QA|DEV)\b[\])]?\s*$/i, '')
    .replace(/\b(PRUEBA|TEST|DEMO|QA|DEV)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Experiencia';
}

function commercialQuoteCode(value: string) {
  const match = value.match(/^(.*)-V(\d+)$/i);
  return match ? `${match[1]} · V${match[2]}` : value;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const parsed = new Date(`${raw}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compactDate(value: unknown) {
  const parsed = parseDate(value);
  if (!parsed) return 'Por confirmar';
  return parsed.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace('.', '')
    .toUpperCase();
}

function timeText(value: unknown) {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 5) : '';
}

function scheduleText(item: Record<string, unknown>) {
  const start = timeText(item.start_time);
  const end = timeText(item.end_time);
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  const schedule = String(item.schedule || '').trim();
  const timeRange = schedule.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
  return timeRange?.[0]?.replace(/\s+/g, '') || 'Por confirmar';
}

function pickupText(item: Record<string, unknown>) {
  const explicit = String(item.pickup_time || item.estimated_pickup_time || '').trim();
  return explicit || 'Por confirmar';
}

function servicePeriod(items: Array<Record<string, unknown>>) {
  const dated = items
    .map(item => ({ raw: item.service_date, parsed: parseDate(item.service_date) }))
    .filter(row => row.parsed)
    .sort((a, b) => (a.parsed as Date).getTime() - (b.parsed as Date).getTime());
  if (!dated.length) return { start: 'Por confirmar', end: 'Por confirmar' };
  return { start: compactDate(dated[0].raw), end: compactDate(dated[dated.length - 1].raw) };
}

function modeExplanation(mode: string) {
  const lower = mode.toLowerCase();
  if (lower.includes('semi')) return 'Grupo reducido compartido, con una experiencia más personalizada.';
  if (lower.includes('private') || lower.includes('privado')) return 'Servicio dedicado exclusivamente al grupo de esta reserva.';
  if (lower.includes('regular')) return 'Servicio compartido con otros pasajeros.';
  if (lower.includes('fixed')) return 'Servicio dedicado con tarifa aplicada al servicio completo.';
  return 'Servicio configurado según las condiciones indicadas en esta propuesta.';
}

export function concisePolicy(summary?: string | null) {
  const source = String(summary || '');
  const special = /Alta Montaña|Uyuni/i.test(source)
    ? 'Servicios especiales pueden tener condiciones particulares informadas antes de confirmar.'
    : '';
  return [
    '+6 días antes: devolución 100%*',
    '5 días a más de 24 h: devolución 70%*',
    'Menos de 24 h / no-show: sin devolución',
    special,
  ].filter(Boolean);
}

type QuoteOptions = {
  hotelName?: string;
  clientName?: string;
  destination?: string;
  depositPct?: number;
};

function drawBrandHeader(doc: jsPDF, quoteCode: string) {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text('LINK VENTAS', 18, 16);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.text('HOTEL EXPERIENCE', 18, 20.5);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('COTIZACIÓN', 192, 16, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.9); doc.text(commercialQuoteCode(quoteCode), 192, 20.5, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(18, 27, 192, 27);
}

function drawSummaryCell(doc: jsPDF, x: number, y: number, label: string, value: string, width: number) {
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.2); doc.text(label.toUpperCase(), x, y);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4);
  doc.text(doc.splitTextToSize(value, width).slice(0, 2), x, y + 5);
}

function drawServiceTable(doc: jsPDF, items: Array<Record<string, unknown>>, y: number) {
  const left = 18;
  const right = 192;
  const columns = [
    { key: 'date', label: 'FECHA', width: 19 },
    { key: 'schedule', label: 'HORARIO', width: 22 },
    { key: 'pickup', label: 'PICKUP EST.', width: 23 },
    { key: 'service', label: 'EXPERIENCIA', width: 43 },
    { key: 'mode', label: 'MODALIDAD', width: 22 },
    { key: 'pax', label: 'PAX', width: 9 },
    { key: 'unit', label: 'UNIT.', width: 18 },
    { key: 'total', label: 'TOTAL', width: 18 },
  ];
  const count = Math.max(1, items.length);
  const rowHeight = Math.max(4.2, Math.min(10, 68 / count));
  const bodyFont = Math.max(4.1, Math.min(5.5, rowHeight - 0.6));

  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.rect(left, y, right - left, 8, 'FD');
  let x = left;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(4.5);
  columns.forEach(column => {
    const alignRight = column.key === 'unit' || column.key === 'total';
    doc.text(column.label, alignRight ? x + column.width - 1.2 : x + 1.2, y + 5.2, alignRight ? { align: 'right' } : undefined);
    x += column.width;
  });
  y += 8;

  items.forEach((item, index) => {
    if (index % 2 === 1) { doc.setFillColor(252, 251, 249); doc.rect(left, y, right - left, rowHeight, 'F'); }
    doc.setDrawColor(...LINE); doc.line(left, y + rowHeight, right, y + rowHeight);
    const values = [
      compactDate(item.service_date).replace(/\s\d{4}$/, ''),
      scheduleText(item),
      pickupText(item),
      cleanCommercialName(item.product_name).toUpperCase(),
      humanModality(String(item.modality || item.catalog_price_mode || '')),
      String(Math.max(1, Number(item.pax || 1))),
      money(item.unit_price),
      money(item.total_price),
    ];
    x = left;
    values.forEach((value, cellIndex) => {
      const column = columns[cellIndex];
      const isPrice = cellIndex >= 6;
      const isService = cellIndex === 3;
      doc.setTextColor(...INK); doc.setFont('helvetica', isPrice || isService ? 'bold' : 'normal'); doc.setFontSize(bodyFont);
      if (isPrice) doc.text(value, x + column.width - 1.2, y + Math.max(3.2, rowHeight * 0.62), { align: 'right' });
      else {
        const line = doc.splitTextToSize(value, column.width - 2.4)[0] || '';
        doc.text(line, x + 1.2, y + Math.max(3.2, rowHeight * 0.62));
      }
      x += column.width;
    });
    y += rowHeight;
  });
  return y;
}

function drawPolicyBlock(doc: jsPDF, quote: SalesQuoteSnapshot, y: number) {
  const left = 18, right = 192;
  const lines = concisePolicy(quote.policy_summary).slice(0, 3);
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.roundedRect(left, y, right - left, 27, 2.5, 2.5, 'FD');
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.1);
  doc.text('POLÍTICAS DE CANCELACIÓN', left + 6, y + 6.2);
  let rowY = y + 11.4;
  lines.forEach(line => {
    doc.setFillColor(...ACCENT); doc.circle(left + 7, rowY - 1, 0.6, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7); doc.text(line, left + 11, rowY); rowY += 4.1;
  });
  doc.setTextColor(...MUTED); doc.setFontSize(5.0);
  doc.text('* Se descuentan entradas, permisos o servicios de terceros ya emitidos y no reembolsables.', left + 6, y + 24.2);
  return y + 31;
}

function compactExperienceText(item: Record<string, unknown>) {
  const notes = String(item.notes || '').trim();
  if (notes) return notes;
  const parts: string[] = [];
  const description = String(item.description || '').trim();
  const stops = String(item.stops || '').trim();
  const snack = String(item.snack || '').trim();
  if (description) parts.push(description);
  if (stops) parts.push(`Recorrido: ${stops.replace(/\s*\+\s*/g, ', ')}`);
  if (snack) parts.push(`Alimentación: ${snack}`);
  if (!parts.length) parts.push(modeExplanation(String(item.modality || item.catalog_price_mode || '')));
  return parts.join(' · ');
}

function drawCompactDetails(doc: jsPDF, items: Array<Record<string, unknown>>, y: number, maxY = 267) {
  if (!items.length || y >= maxY - 7) return y;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.text('INFORMACIÓN DE LAS EXPERIENCIAS', 18, y); y += 4.8;
  const available = Math.max(0, maxY - y);
  const row = Math.max(4.8, Math.min(9, available / Math.max(1, items.length)));
  items.forEach((item, index) => {
    if (y > maxY - 2) return;
    const title = cleanCommercialName(item.product_name).toUpperCase();
    const detail = compactExperienceText(item);
    doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(4.9); doc.text(String(index + 1).padStart(2, '0'), 18, y);
    doc.setTextColor(...INK); doc.setFontSize(5.7); doc.text((doc.splitTextToSize(title, 55)[0] || ''), 25, y);
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(4.9);
    const maxLines = row >= 7.5 ? 2 : 1;
    doc.text(doc.splitTextToSize(detail, 108).slice(0, maxLines), 82, y);
    y += row;
  });
  return y;
}

export function buildCustomerQuotePdf(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const left = 18;
  const right = 192;
  const lead = (quote.snapshot?.lead || {}) as Record<string, unknown>;
  const items = ((quote.snapshot?.items || []) as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) => `${String(a.service_date || '')}|${String(a.start_time || '')}`.localeCompare(`${String(b.service_date || '')}|${String(b.start_time || '')}`));
  const reference = String(lead.reference || lead.code || '').trim();
  const client = String(options?.clientName || '').trim() || 'Pasajero por confirmar';
  const hotel = String(options?.hotelName || '').trim() || 'Por confirmar';
  const pax = Math.max(1, Number(lead.pax || 1));
  const period = servicePeriod(items);

  drawBrandHeader(doc, quote.quote_code);
  let y = 39;
  doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.text('PROPUESTA PARA', left, y);
  y += 6.5;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text((doc.splitTextToSize(client, 130)[0] || client), left, y);
  y += 9;

  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.roundedRect(left, y, right - left, 27, 3, 3, 'FD');
  drawSummaryCell(doc, left + 6, y + 6.5, 'Inicio servicios', period.start, 35);
  drawSummaryCell(doc, left + 49, y + 6.5, 'Término servicios', period.end, 35);
  drawSummaryCell(doc, left + 92, y + 6.5, 'Pasajeros', `${pax} ${pax === 1 ? 'pasajero' : 'pasajeros'}`, 25);
  drawSummaryCell(doc, left + 125, y + 6.5, 'Hotel / origen', hotel, 43);
  y += 33;

  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.8); doc.text('SERVICIOS COTIZADOS', left, y);
  if (reference) { doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.text(`Ref. ${reference}`, right, y, { align: 'right' }); }
  y += 6;
  y = drawServiceTable(doc, items, y);
  y += 5.5;

  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(left, y, right, y); y += 7.5;
  const totalPerPax = pax > 0 ? Number(quote.total || 0) / pax : Number(quote.total || 0);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.text(`TOTAL / PAX (${pax})`, left, y);
  doc.setTextColor(...INK); doc.setFontSize(8.2); doc.text(money(totalPerPax), left + 52, y);
  doc.setTextColor(...MUTED); doc.setFontSize(5.8); doc.text('TOTAL DE LA EXPERIENCIA', right - 66, y);
  doc.setTextColor(...INK); doc.setFontSize(17); doc.text(money(quote.total), right, y + 1.5, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2); doc.text('CLP', right, y + 7, { align: 'right' });
  y += 13;

  const depositPct = Number(options?.depositPct || 0);
  if (depositPct > 0 && depositPct < 100) {
    const deposit = Number(quote.total || 0) * (depositPct / 100);
    const balance = Number(quote.total || 0) - deposit;
    doc.setFillColor(...PAPER); doc.roundedRect(left, y, right - left, 12, 2, 2, 'F');
    doc.setTextColor(...MUTED); doc.setFontSize(5.8); doc.text(`Reserva ${depositPct}%`, left + 6, y + 5);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(deposit), left + 61, y + 5, { align: 'right' });
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.text('Saldo restante', left + 102, y + 5);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(balance), right - 6, y + 5, { align: 'right' });
    y += 16;
  }

  y = drawPolicyBlock(doc, quote, y);
  y = drawCompactDetails(doc, items, y, 267);

  if (y < 270) {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(4.9);
    doc.text('Horarios y puntos de encuentro marcados “Por confirmar” se actualizan al coordinar el servicio.', left, Math.min(272, y + 2.5));
  }

  doc.setDrawColor(...LINE); doc.line(left, 276, right, 276);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text('LINK · HOTEL EXPERIENCE', left, 282);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2); doc.text('Cotización comercial · valores expresados en pesos chilenos', right, 282, { align: 'right' });

  const fileName = `${quote.quote_code}.pdf`;
  return { doc, fileName };
}

export function downloadCustomerQuote(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  doc.save(fileName);
  return fileName;
}

export async function shareCustomerQuote(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: `Cotización ${quote.quote_code}`, text: 'Cotización LINK Ventas', files: [file] });
    return 'shared' as const;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded' as const;
}
