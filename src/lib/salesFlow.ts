import { supabase } from './supabase';
import type { Lead, LeadService, PassengerDraft, SalesQuoteSnapshot } from '../types';

export async function updateSalesFlow(leadId: string, payload: Record<string, unknown>) {
  if (!leadId) throw new Error('Primero guarda el ingreso.');
  const { data, error } = await supabase.rpc('update_link_sales_flow', {
    p_lead_id: leadId,
    p_payload: payload,
  });
  if (error) throw error;
  return data as { lead_id: string; sales_stage: string };
}

export async function createQuoteSnapshot(leadId: string) {
  if (!leadId) throw new Error('Primero guarda el ingreso.');
  const { data, error } = await supabase.rpc('create_link_quote_snapshot', { p_lead_id: leadId });
  if (error) throw error;
  return data as SalesQuoteSnapshot;
}

export async function markQuoteStatus(quoteId: string, status: 'sent' | 'accepted') {
  const { data, error } = await supabase.rpc('mark_link_quote_status', {
    p_quote_id: quoteId,
    p_status: status,
  });
  if (error) throw error;
  return data as { id: string; status: string; lead_id: string };
}

export async function loadLatestQuote(leadId: string) {
  const { data, error } = await supabase
    .from('sales_quotes')
    .select('*')
    .eq('lead_id', leadId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as SalesQuoteSnapshot | null;
}

export async function sharePaymentLink(reference: string, paymentLink: string) {
  const url = paymentLink.trim();
  if (!url) throw new Error('Agrega el link de pago.');
  const text = `Reserva ${reference || 'LINK'} · link de pago: ${url}`;
  if (navigator.share) {
    await navigator.share({ title: `Pago ${reference || 'LINK'}`, text, url });
    return 'shared' as const;
  }
  await navigator.clipboard.writeText(text);
  return 'copied' as const;
}

export function itineraryText(input: {
  reference: string;
  leadCode: string;
  checkin: string;
  checkout: string;
  hotelName?: string;
  pickupLocation?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  passengers: PassengerDraft[];
  services: LeadService[];
}) {
  const lines: string[] = [];
  lines.push(`Reserva: ${input.reference || input.leadCode}`);
  if (input.hotelName) lines.push(`Origen / hotel: ${input.hotelName}`);
  if (input.checkin) lines.push(`Arribo: ${input.checkin}`);
  if (input.checkout) lines.push(`Salida: ${input.checkout}`);
  if (input.arrivalFlight) lines.push(`Vuelo de llegada: ${input.arrivalFlight}`);
  if (input.departureFlight) lines.push(`Vuelo de salida: ${input.departureFlight}`);
  if (input.pickupLocation) lines.push(`Punto de recogida: ${input.pickupLocation}`);
  lines.push('');
  lines.push('ITINERARIO');
  input.services
    .slice()
    .sort((a, b) => String(a.fecha_servicio || '').localeCompare(String(b.fecha_servicio || '')))
    .forEach((service, index) => {
      const time = service.hora_inicio ? ` · ${String(service.hora_inicio).slice(0, 5)}` : '';
      const modality = service.modality ? ` · ${humanModality(service.modality)}` : '';
      lines.push(`${index + 1}. ${service.fecha_servicio || 'Fecha por confirmar'}${time} — ${service.producto}${modality}`);
      if (service.observacion) lines.push(`   ${service.observacion}`);
    });
  const restrictions = input.passengers
    .map((passenger, index) => {
      const notes = [passenger.dietary_restrictions, passenger.medical_notes].filter(Boolean).join(' · ');
      return notes ? `P${String(index + 1).padStart(2, '0')} ${passenger.full_name || 'por completar'}: ${notes}` : '';
    })
    .filter(Boolean);
  if (restrictions.length) {
    lines.push('');
    lines.push('INFORMACIÓN INFORMADA POR LOS PASAJEROS');
    lines.push(...restrictions);
  }
  return lines.join('\n');
}

export async function sendItineraryEmail(input: {
  operationsUrl: string;
  to: string;
  subject: string;
  body: string;
  reference: string;
  leadCode: string;
}) {
  if (!input.operationsUrl) throw new Error('La conexión con HOTEL EXPERIENCE Operaciones no está configurada.');
  if (!input.to.trim()) throw new Error('Falta el email del pasajero principal.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesión requerida para enviar el correo.');
  const response = await fetch(`${input.operationsUrl.replace(/\/$/, '')}/api/send-communication`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      body: input.body,
      leadName: input.reference,
      leadCode: input.leadCode,
      communicationType: 'Itinerario confirmado',
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || 'No se pudo enviar el itinerario.');
  return result as { ok: boolean; id?: string | null };
}

export function humanModality(value?: string | null) {
  const key = String(value || '').toLowerCase();
  if (key.includes('semi')) return 'Semi privado';
  if (key.includes('private') || key.includes('privado')) return 'Privado';
  if (key.includes('regular')) return 'Regular / compartido';
  if (key.includes('fixed')) return 'Servicio dedicado';
  return value ? value.replace(/_/g, ' ') : 'Por definir';
}
