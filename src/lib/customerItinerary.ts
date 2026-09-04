import { jsPDF } from 'jspdf';
import type { PassengerDraft, ServiceDraft } from '../types';
import { humanModality } from './salesFlow';

const INK: [number, number, number] = [24, 24, 22];
const MUTED: [number, number, number] = [104, 101, 95];
const LINE: [number, number, number] = [220, 216, 208];
const PAPER: [number, number, number] = [248, 247, 244];
const SOFT: [number, number, number] = [242, 241, 237];
const ACCENT: [number, number, number] = [143, 126, 106];

export type CustomerItineraryService = ServiceDraft & {
  durationHours?: number | null;
  scheduleLabel?: string | null;
};

export type CustomerItineraryInput = {
  reference: string;
  leadCode?: string;
  hotelName?: string;
  pickupLocation?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  passengers: PassengerDraft[];
  services: CustomerItineraryService[];
};

function clean(value: unknown, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function parseDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayName(value: string) {
  const date = parseDate(value);
  if (!date) return 'Por confirmar';
  return date.toLocaleDateString('es-CL', { weekday: 'long' }).replace(/^./, letter => letter.toUpperCase());
}

function dateText(value: string) {
  const date = parseDate(value);
  if (!date) return 'Por confirmar';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeText(value?: string | null) {
  const raw = clean(value);
  return raw ? raw.slice(0, 5) : '';
}

function addMinutes(time: string, minutes: number) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  const safe = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function serviceSchedule(service: CustomerItineraryService) {
  const start = timeText(service.start_time);
  if (start && Number(service.durationHours || 0) > 0) {
    const end = addMinutes(start, Math.round(Number(service.durationHours) * 60));
    if (end) return `${start}-${end}`;
  }
  if (start) return start;
  const source = clean(service.scheduleLabel);
  const range = source.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
  if (range) return range[0].replace(/\s+/g, '').replace('–', '-');
  return 'Por confirmar';
}

function pickupWindow(service: CustomerItineraryService) {
  const source = clean(service.notes);
  const match = source.match(/(?:pickup|pick\s*up|recogida|retiro)[^0-9]{0,24}(\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?)/i);
  return match?.[1]?.replace(/\s+/g, '').replace('–', '-') || 'Por confirmar';
}

function passengerNames(passengers: PassengerDraft[]) {
  const names = passengers
    .map((passenger, index) => clean(passenger.full_name, `P${String(index + 1).padStart(2, '0')}`))
    .filter(Boolean);
  return names.length ? names.join(' / ') : 'Pasajeros por confirmar';
}

function modalityExplanation(mode: string) {
  const key = mode.toLowerCase();
  if (key.includes('semi')) return 'Grupo reducido compartido. La capacidad final depende de la experiencia y del operador asignado.';
  if (key.includes('private') || key.includes('privado')) return 'Servicio exclusivo para los pasajeros incluidos en esta reserva.';
  if (key.includes('regular')) return 'Servicio compartido con otros pasajeros. La capacidad final depende de la experiencia y del operador asignado.';
  return 'Servicio configurado de acuerdo con las condiciones informadas en la reserva.';
}

function drawHeader(doc: jsPDF, reference: string) {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text('LINK VENTAS', 16, 14);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.text('HOTEL EXPERIENCE', 16, 18.2);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text('ITINERARIO', 194, 14, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.text(clean(reference, 'Reserva'), 194, 18.2, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(16, 24, 194, 24);
}

function drawTable(doc: jsPDF, services: CustomerItineraryService[], y: number) {
  const left = 16;
  const right = 194;
  const columns = [
    { label: 'DÍA', width: 25 },
    { label: 'FECHA', width: 25 },
    { label: 'HORARIO', width: 29 },
    { label: 'PICKUP EST.', width: 30 },
    { label: 'EXPERIENCIA', width: 48 },
    { label: 'MODALIDAD', width: 21 },
  ];
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.rect(left, y, right - left, 9, 'FD');
  let x = left;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(4.7);
  columns.forEach(column => { doc.text(column.label, x + 1.5, y + 5.7); x += column.width; });
  y += 9;

  services.forEach((service, index) => {
    const title = clean(service.product_name, 'Experiencia').toUpperCase();
    const titleLines = doc.splitTextToSize(title, 44);
    const height = Math.max(11, 6.8 + titleLines.length * 3);
    if (index % 2 === 1) { doc.setFillColor(252, 251, 249); doc.rect(left, y, right - left, height, 'F'); }
    doc.setDrawColor(...LINE); doc.line(left, y + height, right, y + height);
    const values = [
      dayName(service.date),
      dateText(service.date),
      serviceSchedule(service),
      pickupWindow(service),
      title,
      humanModality(service.modality || ''),
    ];
    x = left;
    values.forEach((value, columnIndex) => {
      const column = columns[columnIndex];
      const strong = columnIndex === 4;
      doc.setTextColor(...INK); doc.setFont('helvetica', strong ? 'bold' : 'normal'); doc.setFontSize(strong ? 5.2 : 5);
      doc.text(doc.splitTextToSize(value, column.width - 3), x + 1.5, y + 4.8);
      x += column.width;
    });
    y += height;
  });
  return y;
}

export function buildCustomerItineraryPdf(input: CustomerItineraryInput) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const reference = clean(input.reference || input.leadCode, 'Reserva');
  const services = input.services.slice().sort((a, b) => `${a.date}|${a.start_time}`.localeCompare(`${b.date}|${b.start_time}`));
  drawHeader(doc, reference);

  let y = 34;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.3); doc.text('PASAJEROS', 16, y);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.text(doc.splitTextToSize(passengerNames(input.passengers), 132), 46, y);
  y += 8;
  doc.setTextColor(...MUTED); doc.setFontSize(5.3); doc.text('HOTEL / ORIGEN', 16, y);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.3); doc.text(clean(input.hotelName, 'Por confirmar'), 46, y);
  y += 10;

  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('ITINERARIO', 105, y, { align: 'center' });
  y += 7;
  y = drawTable(doc, services, y);
  y += 6;

  const pickupPlace = clean(input.pickupLocation || input.hotelName, 'punto informado para cada servicio');
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3);
  doc.text(`Punto de recogida y retorno: ${pickupPlace}.`, 16, y);
  y += 5;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7);
  doc.text('Los horarios y pickups marcados como "Por confirmar" se coordinan antes del servicio. Pueden ajustarse por clima, condiciones operativas o disponibilidad.', 16, y, { maxWidth: 178 });
  y += 10;

  const modes = Array.from(new Set(services.map(service => humanModality(service.modality || '')).filter(Boolean))).slice(0, 3);
  if (modes.length) {
    const gap = 4;
    const width = (178 - gap * (modes.length - 1)) / modes.length;
    let x = 16;
    modes.forEach(mode => {
      doc.setFillColor(...SOFT); doc.setDrawColor(...LINE); doc.roundedRect(x, y, width, 25, 2, 2, 'FD');
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text(mode.toUpperCase(), x + 4, y + 6);
      doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.1);
      doc.text(doc.splitTextToSize(modalityExplanation(mode), width - 8), x + 4, y + 11);
      x += width + gap;
    });
    y += 32;
  }

  if (input.arrivalFlight || input.departureFlight) {
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.text('DATOS DE VIAJE', 16, y); y += 5;
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7);
    const travel = [input.arrivalFlight ? `Llegada: ${input.arrivalFlight}` : '', input.departureFlight ? `Salida: ${input.departureFlight}` : ''].filter(Boolean).join('   |   ');
    doc.text(travel, 16, y); y += 8;
  }

  doc.setFillColor(239, 241, 244); doc.rect(16, y, 178, 7, 'F');
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text('RECOMENDACIONES IMPORTANTES', 105, y + 4.8, { align: 'center' });
  y += 11;
  const recommendations = [
    'Usar ropa cómoda y calzado adecuado para terreno irregular.',
    'Llevar protección solar, lentes de sol, agua y abrigo, especialmente para altura, amaneceres, atardeceres y actividades nocturnas.',
    'Estar preparado al menos 10 minutos antes del pickup confirmado.',
    'Informar con anticipación restricciones alimentarias, condiciones médicas o necesidades de movilidad relevantes para ejecutar el servicio.',
  ];
  doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
  recommendations.forEach(item => { doc.text(`- ${item}`, 20, y, { maxWidth: 170 }); y += 5.3; });

  const remaining = 267 - y;
  if (remaining > 15) {
    const notes = services.map(service => clean(service.notes)).filter(Boolean).slice(0, 2);
    if (notes.length) {
      y += 2; doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.3); doc.text('INFORMACIÓN ADICIONAL', 16, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.1);
      notes.forEach(note => { const lines = doc.splitTextToSize(note, 174).slice(0, 2); doc.text(lines, 16, y); y += lines.length * 3.5 + 2; });
    }
  }

  doc.setDrawColor(...LINE); doc.line(16, 276, 194, 276);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.text('LINK · HOTEL EXPERIENCE', 16, 282);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.1); doc.text(`Itinerario ${clean(input.leadCode || reference)}`, 194, 282, { align: 'right' });
  return { doc, fileName: `ITINERARIO_${clean(input.leadCode || reference).replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf` };
}

export function downloadCustomerItinerary(input: CustomerItineraryInput) {
  const { doc, fileName } = buildCustomerItineraryPdf(input);
  doc.save(fileName);
  return fileName;
}
