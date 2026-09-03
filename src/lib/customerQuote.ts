import { jsPDF } from 'jspdf';
import type { SalesQuoteSnapshot } from '../types';
import { humanModality } from './salesFlow';

const INK: [number, number, number] = [27, 27, 25];
const MUTED: [number, number, number] = [111, 106, 99];
const LINE: [number, number, number] = [224, 220, 212];
const PAPER: [number, number, number] = [249, 248, 245];
const ACCENT: [number, number, number] = [145, 128, 108];

const money = (value: unknown) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

const date = (value: unknown) => {
  if (!value) return 'Por confirmar';
  const raw = String(value);
  const parsed = new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CL', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

function dateParts(value: unknown) {
  if (!value) return { day: '—', month: 'POR DEFINIR', year: '' };
  const raw = String(value);
  const parsed = new Date(`${raw.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return { day: raw, month: '', year: '' };
  return {
    day: parsed.toLocaleDateString('es-CL', { day: '2-digit' }),
    month: parsed.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '').toUpperCase(),
    year: String(parsed.getFullYear()),
  };
}

function cleanCommercialName(value: unknown) {
  const raw = String(value || 'Experiencia').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return raw
    .replace(/\s*[([]?\b(PRUEBA|TEST|DEMO|QA|DEV)\b[\])]?\s*$/i, '')
    .replace(/\b(PRUEBA|TEST|DEMO)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Experiencia';
}

function commercialQuoteCode(value: string) {
  const match = value.match(/^(.*)-V(\d+)$/i);
  return match ? `${match[1]} · V${match[2]}` : value;
}

function modeExplanation(mode: string) {
  const lower = mode.toLowerCase();
  if (lower.includes('semi')) return 'Grupo reducido compartido, con una experiencia más personalizada.';
  if (lower.includes('private') || lower.includes('privado')) return 'Servicio dedicado exclusivamente al grupo de esta reserva.';
  if (lower.includes('regular')) return 'Servicio compartido con otros pasajeros. Tarifa expresada por persona.';
  if (lower.includes('fixed')) return 'Servicio dedicado con tarifa aplicada al servicio completo.';
  return 'Servicio configurado según las condiciones indicadas en esta propuesta.';
}

export function concisePolicy(summary?: string | null) {
  const source = String(summary || '');
  const special = /Alta Montaña|Uyuni/i.test(source)
    ? 'Los servicios especiales pueden tener condiciones particulares, informadas antes de confirmar.'
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

function drawContinuationHeader(doc: jsPDF, quoteCode: string) {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text('LINK VENTAS', 18, 15);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.text('HOTEL EXPERIENCE', 18, 19.5);
  doc.setTextColor(...MUTED); doc.setFontSize(6.3); doc.text(commercialQuoteCode(quoteCode), 192, 16.5, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(18, 24, 192, 24);
}

function ensureSpace(doc: jsPDF, quoteCode: string, y: number, needed = 18) {
  if (y + needed <= 278) return y;
  doc.addPage();
  drawContinuationHeader(doc, quoteCode);
  return 34;
}

function drawDateCard(doc: jsPDF, x: number, y: number, label: string, value: unknown) {
  const parts = dateParts(value);
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.roundedRect(x, y, 38, 27, 2.5, 2.5, 'FD');
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.text(label.toUpperCase(), x + 4, y + 5.5);
  doc.setTextColor(...INK); doc.setFontSize(15); doc.text(parts.day, x + 4, y + 15.5);
  doc.setFontSize(6.5); doc.text(parts.month, x + 18, y + 12.7);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.text(parts.year, x + 18, y + 17.3);
}

export function buildCustomerQuotePdf(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const right = 192;
  const left = 18;
  const width = right - left;
  const lead = (quote.snapshot?.lead || {}) as Record<string, unknown>;
  const items = (quote.snapshot?.items || []) as Array<Record<string, unknown>>;
  const reference = String(lead.reference || lead.code || '');
  const client = String(options?.clientName || '').trim() || 'Tu viaje';
  const destination = options?.destination || 'San Pedro de Atacama';
  const hotel = options?.hotelName || 'Hotel / alojamiento por definir';
  const pax = Math.max(1, Number(lead.pax || 1));
  let y = 18;

  // Brand + discreet document identity.
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('LINK VENTAS', left, y);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text('HOTEL EXPERIENCE', left, y + 5);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('COTIZACIÓN', right, y, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.text(commercialQuoteCode(quote.quote_code), right, y + 5, { align: 'right' });
  y += 15;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.35); doc.line(left, y, right, y); y += 13;

  // Travel-first hero.
  doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4); doc.text('PROPUESTA PARA', left, y);
  y += 7;
  doc.setTextColor(...INK); doc.setFontSize(18); doc.text(doc.splitTextToSize(client, 130), left, y);
  y += 8;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2);
  doc.text(`Esta es tu propuesta de experiencias para ${destination}.`, left, y); y += 10;

  drawDateCard(doc, left, y, 'Llegada', lead.checkin);
  drawDateCard(doc, left + 44, y, 'Salida', lead.checkout);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.text('VIAJEROS', left + 94, y + 5.5);
  doc.setTextColor(...INK); doc.setFontSize(10.5); doc.text(`${pax} ${pax === 1 ? 'pasajero' : 'pasajeros'}`, left + 94, y + 12);
  doc.setTextColor(...MUTED); doc.setFontSize(5.8); doc.text('HOTEL / ORIGEN', left + 94, y + 19);
  doc.setTextColor(...INK); doc.setFontSize(8.2); doc.text(doc.splitTextToSize(hotel, 77), left + 94, y + 24.5);
  y += 34;
  if (reference) {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.text(`Referencia de reserva: ${reference}`, left, y);
    y += 10;
  }

  // Experiences.
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text('EXPERIENCIAS SELECCIONADAS', left, y); y += 8;

  items.forEach((item, index) => {
    const description = String(item.description || '').trim();
    const mode = humanModality(String(item.modality || item.catalog_price_mode || ''));
    const explanation = modeExplanation(String(item.modality || item.catalog_price_mode || ''));
    const title = cleanCommercialName(item.product_name);
    const itemPax = Math.max(1, Number(item.pax || 1));
    const detail = `${date(item.service_date)} · ${mode} · ${itemPax} ${itemPax === 1 ? 'pasajero' : 'pasajeros'}`;
    const bodyLines = doc.splitTextToSize(description || explanation, 128);
    const cardHeight = Math.max(35, 27 + bodyLines.length * 3.5);
    y = ensureSpace(doc, quote.quote_code, y, cardHeight + 8);

    doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
    doc.roundedRect(left, y, width, cardHeight, 3, 3, 'FD');

    doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text(String(index + 1).padStart(2, '0'), left + 6, y + 8);
    doc.setTextColor(...INK); doc.setFontSize(11.2); doc.text(doc.splitTextToSize(title.toUpperCase(), 118), left + 18, y + 8);
    doc.setTextColor(...INK); doc.setFontSize(10.5); doc.text(money(item.total_price), right - 6, y + 8, { align: 'right' });
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.text(detail, left + 18, y + 16);
    doc.setFontSize(6.7); doc.text(bodyLines, left + 18, y + 23);
    y += cardHeight + 7;
  });

  // Commercial total.
  y = ensureSpace(doc, quote.quote_code, y, options?.depositPct ? 48 : 34);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(left, y, right, y); y += 9;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text('TOTAL DE LA EXPERIENCIA', left, y);
  doc.setTextColor(...INK); doc.setFontSize(23); doc.text(money(quote.total), right, y + 3, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); doc.text('CLP · valor total de los servicios seleccionados', right, y + 9, { align: 'right' });
  y += 17;

  const depositPct = Number(options?.depositPct || 0);
  if (depositPct > 0 && depositPct < 100) {
    const deposit = Number(quote.total || 0) * (depositPct / 100);
    const balance = Number(quote.total || 0) - deposit;
    doc.setFillColor(...PAPER); doc.roundedRect(left, y, width, 18, 2.5, 2.5, 'F');
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(`Reserva ${depositPct}%`, left + 6, y + 7);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(deposit), left + 58, y + 7, { align: 'right' });
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.text('Saldo restante', left + 96, y + 7);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(balance), right - 6, y + 7, { align: 'right' });
    y += 25;
  }

  // Short policy summary, not a contract block.
  y = ensureSpace(doc, quote.quote_code, y, 43);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('CONDICIONES PRINCIPALES', left, y); y += 7;
  const policy = concisePolicy(quote.policy_summary);
  policy.slice(0, 3).forEach(line => {
    doc.setFillColor(...ACCENT); doc.circle(left + 1.5, y - 1.1, 0.8, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.text(line, left + 5, y); y += 5;
  });
  doc.setTextColor(...MUTED); doc.setFontSize(6.1);
  doc.text('* Descontando entradas, permisos o servicios de terceros ya emitidos y no reembolsables.', left, y + 1); y += 6;
  if (policy[3]) { doc.text(doc.splitTextToSize(policy[3], 170), left, y); y += 5; }
  doc.setFontSize(5.9); doc.text('Las condiciones completas aplicables a la reserva prevalecen sobre este resumen.', left, y); y += 10;

  doc.setDrawColor(...LINE); doc.line(left, y, right, y); y += 7;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text('LINK · HOTEL EXPERIENCE', left, y);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.text('Cotización comercial · valores expresados en pesos chilenos', right, y, { align: 'right' });

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
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded' as const;
}
