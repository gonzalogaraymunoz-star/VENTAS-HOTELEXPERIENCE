import { supabase } from './supabase';
import type { PassengerDraft, ServiceDraft } from '../types';

export type OperationalPassengerRow = {
  id: string;
  passenger_code: string;
  first_name?: string | null;
  last_name?: string | null;
  gender?: string | null;
  disability_type?: string | null;
  medical_notes?: string | null;
};

export async function loadOperationalPassengerData(leadId: string) {
  const [passengerRes, serviceRes] = await Promise.all([
    supabase
      .from('passengers')
      .select('id,passenger_code,first_name,last_name,gender,disability_type,medical_notes')
      .eq('lead_id', leadId)
      .order('is_primary', { ascending: false })
      .order('passenger_code', { ascending: true }),
    supabase
      .from('lead_services')
      .select('id,lead_service_passengers(passenger_id,position,confirmed)')
      .eq('lead_id', leadId)
      .eq('booking_status', 'quoted')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  if (passengerRes.error) throw passengerRes.error;
  if (serviceRes.error) throw serviceRes.error;
  const passengers = (passengerRes.data || []) as OperationalPassengerRow[];
  const passengerIndex = new Map(passengers.map((row, index) => [row.id, index]));
  const participantMatrix = (serviceRes.data || []).map((service: any) => ({
    service_id: service.id as string,
    passenger_indexes: (service.lead_service_passengers || [])
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((link: any) => passengerIndex.get(link.passenger_id))
      .filter((value: number | undefined): value is number => value != null),
    confirmed: (service.lead_service_passengers || []).length > 0 && (service.lead_service_passengers || []).every((link: any) => Boolean(link.confirmed)),
  }));
  return { passengers, participantMatrix };
}

export async function persistOperationalPassengerData(leadId: string, passengers: PassengerDraft[], services: ServiceDraft[]) {
  if (!leadId) return;
  const operationalRows = passengers.map(passenger => ({
    first_name: passenger.first_name || '',
    last_name: passenger.last_name || '',
    gender: passenger.gender || '',
    disability_type: passenger.disability_type || '',
    medical_notes: passenger.medical_notes || '',
  }));
  const matrix = services.map((service, serviceIndex) => ({
    service_index: serviceIndex,
    passenger_indexes: service.passenger_indexes?.length
      ? service.passenger_indexes
      : Array.from({ length: Math.min(passengers.length, Math.max(1, Number(service.pax || 1))) }, (_, index) => index),
  }));
  const [passengerResult, matrixResult] = await Promise.all([
    supabase.rpc('update_passenger_operational_fields', { p_lead_id: leadId, p_rows: operationalRows }),
    supabase.rpc('set_link_service_participant_matrix', { p_lead_id: leadId, p_matrix: matrix }),
  ]);
  if (passengerResult.error) throw passengerResult.error;
  if (matrixResult.error) throw matrixResult.error;
}
