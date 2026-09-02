import { jsPDF } from 'jspdf';

export type ManualQuoteLine = {
  name: string;
  quantity: number;
  unitPrice: number;
};

export type ManualQuoteData = {
  clientName?: string;
  contact?: string;
  notes?: string;
  lines: ManualQuoteLine[];
};

const money = (value: number) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

const safeName = (value: string) => value
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

function ensureSpace(doc: jsPDF, y: number, needed = 16) {
  if (y + needed <= 278) return y;
  doc.addPage();
  return 18;
}

export function createManualQuotePdf(data: ManualQuoteData) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const right = pageWidth - 18;
  const total = data.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  let y = 18;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('LINK VENTAS', 18, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(95, 95, 95);
  doc.text('HOTEL EXPERIENCE', 18, y + 5);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('COTIZACIÓN MANUAL', right, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(new Date().toLocaleDateString('es-CL'), right, y + 6, { align: 'right' });

  y += 19;
  doc.setDrawColor(25, 25, 25);
  doc.setLineWidth(0.45);
  doc.line(18, y, right, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text('CLIENTE', 18, y);
  doc.text('CONTACTO', 110, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(25, 25, 25);
  doc.text(doc.splitTextToSize(data.clientName || 'Por definir', 80), 18, y + 5);
  doc.text(doc.splitTextToSize(data.contact || 'Por definir', 80), 110, y + 5);
  y += 17;

  doc.setFillColor(247, 246, 242);
  doc.rect(18, y, right - 18, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text('ÍTEM', 20, y + 5);
  doc.text('CANT.', 125, y + 5, { align: 'right' });
  doc.text('PRECIO', 158, y + 5, { align: 'right' });
  doc.text('TOTAL', right - 1, y + 5, { align: 'right' });
  y += 11;

  data.lines.filter(line => line.name.trim()).forEach((line) => {
    const lineTotal = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const title = doc.splitTextToSize(line.name, 90);
    const rowHeight = Math.max(10, title.length * 4.2 + 4);
    y = ensureSpace(doc, y, rowHeight + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(25, 25, 25);
    doc.text(title, 20, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(String(line.quantity || 0), 125, y + 3, { align: 'right' });
    doc.text(money(line.unitPrice), 158, y + 3, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(money(lineTotal), right - 1, y + 3, { align: 'right' });
    doc.setDrawColor(225, 225, 222);
    doc.setLineWidth(0.2);
    doc.line(18, y + rowHeight, right, y + rowHeight);
    y += rowHeight + 2;
  });

  y = ensureSpace(doc, y + 5, 28);
  doc.setDrawColor(25, 25, 25);
  doc.setLineWidth(0.45);
  doc.line(124, y, right, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(65, 65, 65);
  doc.text('TOTAL', 124, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(money(total), right, y, { align: 'right' });
  y += 12;

  if (data.notes?.trim()) {
    y = ensureSpace(doc, y, 24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('OBSERVACIONES', 18, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(doc.splitTextToSize(data.notes.trim(), right - 18), 18, y + 5);
  }

  const fileName = `Cotizacion-manual-${safeName(data.clientName || 'LINK') || 'LINK'}.pdf`;
  return { doc, fileName };
}

export function downloadManualQuote(data: ManualQuoteData) {
  const { doc, fileName } = createManualQuotePdf(data);
  doc.save(fileName);
  return fileName;
}

export async function shareManualQuote(data: ManualQuoteData) {
  const { doc, fileName } = createManualQuotePdf(data);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const shareNavigator = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))) {
    await shareNavigator.share({
      title: 'Cotización LINK Ventas',
      text: data.clientName ? `Cotización para ${data.clientName}` : 'Cotización LINK Ventas',
      files: [file],
    });
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
