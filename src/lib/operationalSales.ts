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

type AutofillServiceEntry = {
  service?: {
    id?: string;
    booking_status?: string | null;
  } | null;
  participant_ids?: string[] | null;
};

type ReservationAutofillContext = {
  passengers?: Array<OperationalPassengerRow & { is_primary?: boolean | null }>;
  services?: AutofillServiceEntry[];
};

export async function loadOperationalPassengerData(leadId: string) {
  const { data, error } = await supabase.rpc('get_reservation_autofill_context', { p_lead_id: leadId });
  if (error) throw error;

  const context = (data || {}) as ReservationAutofillContext;
  const passengers = (context.passengers || []) as OperationalPassengerRow[];
  const passengerIndex = new Map(passengers.map((row, index) => [row.id, index]));

  const participantMatrix = (context.services || [])
    .filter(entry => entry.service?.booking_status === 'quoted')
    .map(entry => {
      const participantIds = Array.isArray(entry.participant_ids) ? entry.participant_ids : [];
      const passengerIndexes = participantIds
        .map(passengerId => passengerIndex.get(passengerId))
        .filter((value: number | undefined): value is number => value != null);
      return {
        service_id: String(entry.service?.id || ''),
        passenger_indexes: passengerIndexes,
        confirmed: participantIds.length > 0,
      };
    });

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
