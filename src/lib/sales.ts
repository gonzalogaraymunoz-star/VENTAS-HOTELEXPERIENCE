import { supabase } from './supabase';
import type {
  HotelPartner,
  Lead,
  LeadService,
  PassengerDraft,
  PaymentMovement,
  Product,
  SellerProfile,
  ServiceDraft,
  Supplier,
} from '../types';
import { economics } from './money';

export async function loadReferenceData() {
  const [hotelsRes, productsRes, suppliersRes, sellersRes] = await Promise.all([
    supabase.from('hotel_partners').select('*').eq('active', true).order('name'),
    supabase.from('product_catalog').select('*').eq('active', true).order('category').order('name'),
    supabase.from('suppliers').select('id,name,supplier_type,active').eq('active', true).order('name'),
    supabase.rpc('list_link_sellers'),
  ]);
  if (hotelsRes.error) throw hotelsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (sellersRes.error) throw sellersRes.error;
  return {
    hotels: (hotelsRes.data || []) as HotelPartner[],
    products: (productsRes.data || []) as Product[],
    suppliers: (suppliersRes.data || []) as Supplier[],
    sellers: (sellersRes.data || []) as SellerProfile[],
  };
}

export async function requestPartner(input: {
  sellerProfileId: string;
  name: string;
  partnerType: string;
  leadPrefix: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
}) {
  const payload = {
    seller_profile_id: input.sellerProfileId,
    name: input.name,
    partner_type: input.partnerType || 'hotel',
    lead_prefix: input.leadPrefix,
    contact_name: input.contactName || null,
    email: input.email || null,
    phone: input.phone || null,
    notes: input.notes || null,
  };
  const { data, error } = await supabase.rpc('request_partner', { p_payload: payload });
  if (error) throw error;
  return data as { id: string; status: string; name: string; lead_prefix: string };
}

export async function loadLeads(limit = 250) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, hotel_partners(name,lead_prefix)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as Lead[];
}

export async function loadServices(limit = 400) {
  const { data, error } = await supabase
    .from('lead_services')
    .select('*, leads(codigo,reserva)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as LeadService[];
}

export async function loadPayments(limit = 300) {
  const { data, error } = await supabase
    .from('payment_movements')
    .select('*, lead_services(producto,service_code,leads(codigo))')
    .order('paid_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PaymentMovement[];
}

export type CreateSaleInput = {
  hotelPartnerId: string;
  channel: string;
  priority: string;
  checkin?: string;
  checkout?: string;
  contact: string;
  sellerProfileId: string;
  passengers: PassengerDraft[];
  services: ServiceDraft[];
  notes?: string;
};

export async function createSale(input: CreateSaleInput, confirmNow = false) {
  const hotel = input.hotelPartnerId;
  if (!hotel) throw new Error('Selecciona hotel/origen.');
  if (!input.sellerProfileId) throw new Error('Selecciona un vendedor registrado.');
  if (!input.passengers.length || !input.passengers[0].full_name.trim()) throw new Error('Falta el cliente principal.');
  if (!input.services.length) throw new Error('Agrega al menos un producto.');

  const services = input.services.map((service) => {
    const calc = economics(
      Number(service.unit_price),
      Number(service.pax),
      Number(service.operator_cost),
      Number(service.hotel_commission_pct),
      Number(service.seller_commission_pct),
    );
    if (confirmNow && calc.total <= 0) {
      throw new Error(`El producto ${service.product_name} no tiene precio de venta definido. Guárdalo como cotización o define la tarifa antes de confirmar.`);
    }
    return {
      product_id: service.product_id || null,
      product_code: service.product_code || null,
      product_name: service.product_name,
      category: service.category || null,
      date: service.date || null,
      start_time: service.start_time || null,
      pax: service.pax,
      modality: service.modality || null,
      unit_price: service.unit_price,
      total_price: calc.total,
      operator_cost: calc.cost,
      margin: calc.margin,
      hotel_commission_pct: service.hotel_commission_pct,
      hotel_commission: calc.hotel,
      seller_commission_pct: service.seller_commission_pct,
      seller_commission: calc.seller,
      platform_margin: calc.platform,
      supplier_id: service.supplier_id || null,
      supplier_name: service.supplier_name || null,
      notes: service.notes || null,
    };
  });

  const payload = {
    hotel_partner_id: hotel,
    channel: input.channel || 'Venta directa',
    priority: input.priority || 'Media',
    checkin: input.checkin || null,
    checkout: input.checkout || null,
    contact: input.contact || null,
    seller_profile_id: input.sellerProfileId,
    notes: input.notes || null,
    passengers: input.passengers,
    services,
    confirm_now: confirmNow,
  };

  const { data, error } = await supabase.rpc('create_link_sale', { p_payload: payload });
  if (error) throw error;
  return data as { lead_id: string; lead_code: string; reservation_code: string; status: 'quoted' | 'confirmed' };
}

export async function confirmSale(leadId: string) {
  const { data, error } = await supabase.rpc('confirm_link_sale', { p_lead_id: leadId });
  if (error) throw error;
  return data as { lead_id: string; lead_code: string; confirmed_services?: number; already_confirmed?: boolean };
}

const statusMeta: Record<string, { commercial: string; next: string }> = {
  nuevo: { commercial: 'new', next: 'Contactar cliente' },
  contactado: { commercial: 'contacted', next: 'Detectar interés y necesidad' },
  interesado: { commercial: 'interested', next: 'Preparar cotización' },
  cotizando: { commercial: 'quoting', next: 'Completar cotización' },
  propuesta: { commercial: 'proposal_sent', next: 'Esperar respuesta' },
  esperando: { commercial: 'waiting', next: 'Hacer seguimiento' },
  perdido: { commercial: 'lost', next: 'Cerrar oportunidad perdida' },
  cancelado: { commercial: 'cancelled', next: 'Revisar devolución o cierre' },
  dormido: { commercial: 'dormant', next: 'Reactivar cuando corresponda' },
};

export async function updateLeadStatus(leadId: string, status: string) {
  if (status === 'confirmado') {
    await confirmSale(leadId);
    return;
  }
  const meta = statusMeta[status] || { commercial: status, next: 'Definir próxima acción' };
  const { error } = await supabase
    .from('leads')
    .update({ estado: status, commercial_status: meta.commercial, next_best_action: meta.next })
    .eq('id', leadId);
  if (error) throw error;
}

export async function addPayment(input: {
  serviceId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  counterparty: string;
}) {
  if (!input.serviceId) throw new Error('Selecciona un producto vendido.');
  if (!(input.amount > 0)) throw new Error('El monto debe ser mayor que cero.');
  const { data: sessionData } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('payment_movements')
    .insert({
      lead_service_id: input.serviceId,
      party_type: 'client',
      amount: input.amount,
      currency: 'CLP',
      payment_method: input.paymentMethod || null,
      reference: input.reference || null,
      counterparty_name: input.counterparty || null,
      direction: 'inflow',
      category: 'customer_payment',
      created_by: sessionData.session?.user.id || null,
    })
    .select('*')
    .single();
  if (error) throw error;

  const [{ data: service }, { data: movements }] = await Promise.all([
    supabase.from('lead_services').select('precio_total,precio_venta').eq('id', input.serviceId).single(),
    supabase.from('payment_movements').select('amount,direction').eq('lead_service_id', input.serviceId),
  ]);
  const paid = (movements || [])
    .filter((m: any) => !m.direction || m.direction === 'inflow')
    .reduce((sum: number, m: any) => sum + Number(m.amount || 0), 0);
  const total = Number(service?.precio_total ?? service?.precio_venta ?? 0);
  const state = paid >= total && total > 0 ? 'Pagado' : paid > 0 ? 'Parcial' : 'Pendiente';
  await supabase.from('lead_services').update({ estado_pago: state }).eq('id', input.serviceId);
  return data;
}
