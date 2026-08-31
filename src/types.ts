export type Role = 'admin' | 'manager' | 'agent' | 'viewer';

export type Profile = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: Role | string;
  is_active: boolean;
};

export type HotelPartner = {
  id: string;
  name: string;
  slug: string;
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
  price_mode: string;
  prices: Record<string, number | boolean | string | null>;
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
  prioridad?: string | null;
  estado: string;
  canal?: string | null;
  created_at: string;
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
  producto: string;
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
  sales_channel?: string | null;
  seller_name?: string | null;
  modality?: string | null;
  tour_id?: string | null;
  hora_inicio?: string | null;
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
