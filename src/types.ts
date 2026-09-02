export type Role = 'admin' | 'manager' | 'agent' | 'viewer';

export type Profile = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: Role | string;
  is_active: boolean;
};

export type SellerProfile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  role: string;
};

export type PartnerRequest = {
  id: string;
  requested_by: string;
  seller_profile_id: string;
  name: string;
  partner_type: string;
  lead_prefix: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  hotel_partner_id?: string | null;
  created_at: string;
};

export type HotelPartner = {
  id: string;
  name: string;
  slug: string;
  partner_type?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  lead_prefix?: string | null;
  default_channel?: string | null;
  commission_type?: string | null;
  commission_value?: number | null;
  active: boolean;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  category: string;
  origin?: string | null;
  duration_hours?: number | null;
  schedule?: string | null;
  description?: string | null;
  product_slug?: string | null;
  price_mode: string;
  prices: Record<string, number | boolean | string | null>;
  tax_treatment?: 'manual' | 'taxable' | 'exempt' | string | null;
  tax_rate?: number | null;
  active: boolean;
};

export type Supplier = {
  id: string;
  name: string;
  supplier_type: string;
  active: boolean;
};

export type Lead = {
  id: string;
  codigo: string;
  reserva: string;
  numero_pax: number | null;
  servicio?: string | null;
  precio_venta?: number | null;
  moneda: string;
  checkin?: string | null;
  checkout?: string | null;
  contacto?: string | null;
  nationality?: string | null;
  stay_days?: number | null;
  prioridad?: string | null;
  estado: string;
  canal?: string | null;
  propuesta_enviada?: string | null;
  observaciones_cobros?: string | null;
  reservation_reference?: string | null;
  sales_stage?: string | null;
  quote_sent_at?: string | null;
  quote_accepted_at?: string | null;
  payment_link?: string | null;
  payment_link_sent_at?: string | null;
  arrival_flight_number?: string | null;
  departure_flight_number?: string | null;
  pickup_location?: string | null;
  hotel_room?: string | null;
  itinerary_sent_at?: string | null;
  itinerary_sent_via?: string | null;
  reservation_completed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  created_by?: string | null;
  assigned_to?: string | null;
  hotel_partner_id?: string | null;
  lifecycle_stage?: string | null;
  commercial_status?: string | null;
  next_best_action?: string | null;
  hotel_partners?: { name?: string | null; lead_prefix?: string | null } | null;
};

export type LeadService = {
  id: string;
  lead_id: string;
  service_code?: string | null;
  product_catalog_id?: string | null;
  proposed_supplier_id?: string | null;
  producto: string;
  service_type?: string | null;
  fecha_servicio?: string | null;
  numero_pax?: number | null;
  observacion?: string | null;
  precio_venta?: number | null;
  precio_unitario?: number | null;
  precio_total?: number | null;
  costo_operador_total?: number | null;
  margen_comercial?: number | null;
  comision_hotel?: number | null;
  comision_vendedor?: number | null;
  margen_hotel_experience?: number | null;
  moneda: string;
  estado_pago: string;
  estado_operacion: string;
  booking_status?: string | null;
  pricing_status?: string | null;
  sales_channel?: string | null;
  seller_name?: string | null;
  modality?: string | null;
  tour_id?: string | null;
  hora_inicio?: string | null;
  operation_ready_at?: string | null;
  tax_treatment_snapshot?: string | null;
  tax_rate_snapshot?: number | null;
  created_at: string;
  leads?: { codigo?: string | null; reserva?: string | null } | null;
};

export type PassengerDraft = {
  full_name: string;
  email: string;
  phone: string;
  nationality: string;
  document_type: string;
  document_number: string;
  birth_date: string;
  dietary_restrictions: string;
  medical_notes?: string;
  is_primary: boolean;
};

export type ServiceDraft = {
  product_id: string;
  product_code: string;
  product_name: string;
  category: string;
  date: string;
  start_time: string;
  pax: number;
  modality: string;
  unit_price: number;
  operator_cost: number;
  supplier_id: string;
  supplier_name: string;
  hotel_commission_pct: number;
  seller_commission_pct: number;
  notes: string;
};

export type PaymentMovement = {
  id: string;
  payment_code?: string | null;
  lead_service_id?: string | null;
  party_type: string;
  amount: number;
  currency: string;
  payment_method?: string | null;
  paid_at: string;
  reference?: string | null;
  direction?: string | null;
  counterparty_name?: string | null;
  category?: string | null;
  lead_services?: { producto?: string | null; service_code?: string | null; leads?: { codigo?: string | null } | null } | null;
};

export type SalesQuoteSnapshot = {
  id: string;
  quote_code: string;
  version: number;
  status: 'draft' | 'sent' | 'accepted' | string;
  snapshot: {
    lead?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
    policy?: Record<string, unknown> | null;
  };
  policy_summary?: string | null;
  total: number;
  currency: string;
};
