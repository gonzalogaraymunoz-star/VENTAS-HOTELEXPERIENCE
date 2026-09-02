import { supabase } from './supabase';
import { economics } from './money';
import { stayLength } from './sales';
import type { PassengerDraft, ServiceDraft } from '../types';

export type ReservationDraftInput = {
  hotelPartnerId: string;
  channel: string;
  priority: string;
  checkin: string;
  checkout: string;
  contact: string;
  nationality: string;
  stayDays: number | null;
  sellerProfileId: string;
  passengers: PassengerDraft[];
  services: ServiceDraft[];
  notes: string;
};

export function reservationMissing(input: ReservationDraftInput) {
  const primary = input.passengers[0];
  const missing: string[] = [];
  const primaryName = primary?.full_name?.trim();
  const primaryContact = input.contact.trim() || primary?.email?.trim() || primary?.phone?.trim();

  if (!input.hotelPartnerId) missing.push('hotel / origen');
  if (!input.sellerProfileId) missing.push('vendedor responsable');
  if (!primaryName) missing.push('nombre del cliente');
  if (!primaryContact) missing.push('teléfono o email del cliente');
  if (!input.checkin) missing.push('fecha de arribo');
  if (!input.checkout) missing.push('fecha de salida');
  if (!input.services.length) missing.push('al menos un producto');

  input.services.forEach((service, index) => {
    const label = service.product_name.trim() || `ítem ${index + 1}`;
    if (!service.product_name.trim()) missing.push(`nombre de ${label}`);
    if (!service.date) missing.push(`fecha de ${label}`);
    if (!(Number(service.pax) > 0)) missing.push(`cantidad de ${label}`);
    if (!(Number(service.unit_price) > 0)) missing.push(`precio de ${label}`);
  });

  if (input.checkin && input.checkout && input.checkout < input.checkin) missing.push('salida posterior al arribo');
  return Array.from(new Set(missing));
}

function buildPayload(input: ReservationDraftInput) {
  const primary = input.passengers[0];
  const passengers = input.passengers.length ? input.passengers.map((passenger, index) => ({
    ...passenger,
    nationality: passenger.nationality || (index === 0 ? input.nationality : ''),
  })) : [];

  const services = input.services.map(service => {
    const hotelPct = Number(service.hotel_commission_pct || 15);
    const sellerPct = Number(service.seller_commission_pct || 5);
    const calc = economics(
      Number(service.unit_price || 0),
      Math.max(1, Number(service.pax || 1)),
      Number(service.operator_cost || 0),
      hotelPct,
      sellerPct,
    );
    return {
      product_id: service.product_id || null,
      product_code: service.product_code || null,
      product_name: service.product_name.trim(),
      category: service.category || null,
      service_type: service.category || null,
      date: service.date || null,
      start_time: service.start_time || null,
      pax: Math.max(1, Number(service.pax || 1)),
      modality: service.modality || null,
      unit_price: Number(service.unit_price || 0),
      total_price: calc.total,
      operator_cost: calc.cost,
      margin: calc.margin,
      hotel_commission_pct: hotelPct,
      hotel_commission: calc.hotel,
      seller_commission_pct: sellerPct,
      seller_commission: calc.seller,
      platform_margin: calc.platform,
      supplier_id: service.supplier_id || null,
      supplier_name: service.supplier_name || null,
      notes: service.notes || null,
    };
  });

  return {
    hotel_partner_id: input.hotelPartnerId,
    channel: input.channel || 'Venta directa',
    priority: input.priority === 'Sin fecha' ? 'Media' : input.priority || 'Media',
    checkin: input.checkin || null,
    checkout: input.checkout || null,
    contact: input.contact || null,
    nationality: input.nationality || primary?.nationality || null,
    stay_days: input.stayDays ?? stayLength(input.checkin, input.checkout),
    seller_profile_id: input.sellerProfileId,
    notes: input.notes || null,
    passengers,
    services,
  };
}

export async function updateReservationDraft(leadId: string, input: ReservationDraftInput) {
  if (!leadId) throw new Error('Falta el ingreso a actualizar.');
  const { data, error } = await supabase.rpc('update_link_sale_draft', {
    p_lead_id: leadId,
    p_payload: buildPayload(input),
  });
  if (error) throw error;
  return data as { lead_id: string; lead_code: string; services_updated: number; passengers_updated: number };
}

export async function confirmReservation(leadId: string) {
  const { data, error } = await supabase.rpc('confirm_link_sale', { p_lead_id: leadId });
  if (error) throw error;
  return data as { lead_id: string; lead_code: string; confirmed_services?: number; already_confirmed?: boolean };
}
