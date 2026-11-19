import type { Lead, PassengerDraft } from '../types';

export type IntakePassenger = PassengerDraft & { id?: string; passenger_code?: string; updated_at?: string };
export type IntakeRequest = {
  product: string;
  modality: string;
  pax: number | null;
  date: string;
  time: string;
  pickup: string;
  language: string;
  agreedPrice: number | null;
  currency: string;
  sourceNote: string;
};
export const emptyRequest = (): IntakeRequest => ({ product: '', modality: '', pax: null, date: '', time: '', pickup: '', language: '', agreedPrice: null, currency: '', sourceNote: '' });
export const emptyIntakePassenger = (): IntakePassenger => ({ full_name: '', email: '', phone: '', nationality: '', document_type: '', document_number: '', birth_date: '', dietary_restrictions: '', medical_notes: '', disability_type: '', is_primary: false });

// Empty and zero are different. Never turn an unknown tariff into a free tour.
export function optionalAmount(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('La tarifa debe ser un valor mayor o igual a cero.');
  return number;
}
export function intakeMissing(lead: Pick<Lead, 'hotel_partner_id' | 'assigned_to' | 'contacto'> | null, people: IntakePassenger[], request: IntakeRequest): string[] {
  const missing: string[] = [];
  if (!lead?.hotel_partner_id) missing.push('Hotel / origen');
  if (!lead?.assigned_to) missing.push('Vendedor responsable');
  if (!lead?.contacto && !people.some(person => person.email.trim() || person.phone.trim())) missing.push('Contacto del cliente');
  if (!people.length) missing.push('Pasajeros');
  if (!people.some(person => person.is_primary)) missing.push('Pasajero principal');
  people.forEach((person, index) => {
    const label = `Pasajero ${index + 1}`;
    for (const [field, title] of [['full_name', 'nombre'], ['nationality', 'nacionalidad'], ['document_type', 'tipo de documento'], ['document_number', 'documento'], ['birth_date', 'fecha de nacimiento'], ['dietary_restrictions', 'alimentación'], ['medical_notes', 'necesidades especiales']] as const) {
      if (!person[field]?.trim()) missing.push(`${label}: ${title}`);
    }
  });
  if (!request.product.trim()) missing.push('Servicio solicitado');
  if (!request.modality.trim()) missing.push('Modalidad');
  if (request.pax === null) missing.push('Cantidad de pasajeros del servicio');
  if (!request.date) missing.push('Fecha del servicio');
  if (!request.time) missing.push('Hora del servicio');
  if (!request.pickup.trim()) missing.push('Recogida');
  if (!request.language.trim()) missing.push('Idioma');
  if (request.agreedPrice === null) missing.push('Tarifa acordada');
  if (!request.currency.trim()) missing.push('Moneda');
  return missing;
}

export function intakePayload(lead: Lead | null, people: IntakePassenger[], request: IntakeRequest, contact: string) {
  if (!people.some(person => person.full_name.trim()) && !contact.trim()) throw new Error('Completa al menos un nombre o contacto antes de guardar.');
  if (people.some(person => !person.full_name.trim())) throw new Error('Cada pasajero agregado necesita un nombre. No se guardarán personas inventadas.');
  if (people.filter(person => person.is_primary).length > 1) throw new Error('Selecciona sólo un pasajero principal, o déjalo pendiente.');
  if (request.pax !== null && (!Number.isInteger(request.pax) || request.pax < 1)) throw new Error('La cantidad de pasajeros debe ser un entero positivo.');
  if (request.agreedPrice !== null && (!Number.isFinite(request.agreedPrice) || request.agreedPrice < 0)) throw new Error('Tarifa no válida.');
  return { lead_id: lead?.id ?? null, expected_updated_at: lead?.updated_at ?? null, contact: contact.trim() || null, request, passengers: people.map(person => ({ id: person.id ?? null, expected_updated_at: person.updated_at ?? null, full_name: person.full_name.trim(), email: person.email.trim() || null, phone: person.phone.trim() || null, nationality: person.nationality.trim() || null, document_type: person.document_type.trim() || null, document_number: person.document_number.trim() || null, birth_date: person.birth_date || null, dietary_restrictions: person.dietary_restrictions.trim() || null, medical_notes: person.medical_notes?.trim() || null, disability_type: person.disability_type?.trim() || null, is_primary: person.is_primary })) };
}
