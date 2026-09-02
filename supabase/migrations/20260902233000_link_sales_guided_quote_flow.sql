-- LINK Ventas: flujo único Cotización -> Datos -> Carta -> Pago -> Itinerario -> Operaciones.
-- Esta migración ya fue aplicada al proyecto Supabase compartido.

alter table public.leads add column if not exists reservation_reference text;
alter table public.leads add column if not exists sales_stage text not null default 'quote_intake';
alter table public.leads add column if not exists quote_sent_at timestamptz;
alter table public.leads add column if not exists quote_accepted_at timestamptz;
alter table public.leads add column if not exists payment_link text;
alter table public.leads add column if not exists payment_link_sent_at timestamptz;
alter table public.leads add column if not exists arrival_flight_number text;
alter table public.leads add column if not exists departure_flight_number text;
alter table public.leads add column if not exists pickup_location text;
alter table public.leads add column if not exists hotel_room text;
alter table public.leads add column if not exists itinerary_sent_at timestamptz;
alter table public.leads add column if not exists itinerary_sent_via text;
alter table public.leads add column if not exists reservation_completed_at timestamptz;

create table if not exists public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_code text not null unique,
  lead_id uuid not null references public.leads(id) on delete cascade,
  version integer not null,
  status text not null default 'draft',
  snapshot jsonb not null default '{}'::jsonb,
  policy_summary text,
  total numeric not null default 0,
  currency text not null default 'CLP',
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  unique(lead_id,version)
);

alter table public.sales_quotes enable row level security;
drop policy if exists sales_quotes_read_owned on public.sales_quotes;
create policy sales_quotes_read_owned on public.sales_quotes for select to authenticated using (
  exists(select 1 from public.leads l where l.id=sales_quotes.lead_id and (
    public.current_user_role() in ('admin','manager') or l.created_by=auth.uid() or l.assigned_to=auth.uid()
  ))
);
grant select on public.sales_quotes to authenticated;

create or replace function public.update_link_sales_flow(p_lead_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_role text; v_lead public.leads%rowtype; v_passenger jsonb; v_index integer:=0;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to update sales flow'; end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then raise exception 'No puedes modificar un ingreso asignado a otro vendedor'; end if;
  update public.leads set
    reservation_reference=case when p_payload?'reservation_reference' then nullif(p_payload->>'reservation_reference','') else reservation_reference end,
    sales_stage=case when p_payload?'sales_stage' then coalesce(nullif(p_payload->>'sales_stage',''),sales_stage) else sales_stage end,
    payment_link=case when p_payload?'payment_link' then nullif(p_payload->>'payment_link','') else payment_link end,
    arrival_flight_number=case when p_payload?'arrival_flight_number' then nullif(p_payload->>'arrival_flight_number','') else arrival_flight_number end,
    departure_flight_number=case when p_payload?'departure_flight_number' then nullif(p_payload->>'departure_flight_number','') else departure_flight_number end,
    pickup_location=case when p_payload?'pickup_location' then nullif(p_payload->>'pickup_location','') else pickup_location end,
    hotel_room=case when p_payload?'hotel_room' then nullif(p_payload->>'hotel_room','') else hotel_room end,
    quote_sent_at=case when coalesce((p_payload->>'mark_quote_sent')::boolean,false) then now() else quote_sent_at end,
    quote_accepted_at=case when coalesce((p_payload->>'mark_quote_accepted')::boolean,false) then now() else quote_accepted_at end,
    payment_link_sent_at=case when coalesce((p_payload->>'mark_payment_link_sent')::boolean,false) then now() else payment_link_sent_at end,
    itinerary_sent_at=case when coalesce((p_payload->>'mark_itinerary_sent')::boolean,false) then now() else itinerary_sent_at end,
    itinerary_sent_via=case when coalesce((p_payload->>'mark_itinerary_sent')::boolean,false) then coalesce(nullif(p_payload->>'itinerary_sent_via',''),'email') else itinerary_sent_via end,
    reservation_completed_at=case when coalesce((p_payload->>'mark_completed')::boolean,false) then now() else reservation_completed_at end,
    updated_at=now()
  where id=p_lead_id;
  if p_payload?'passengers' then
    for v_passenger in select value from jsonb_array_elements(coalesce(p_payload->'passengers','[]'::jsonb)) loop
      v_index:=v_index+1;
      update public.passengers set medical_notes=nullif(v_passenger->>'medical_notes',''),dietary_restrictions=nullif(v_passenger->>'dietary_restrictions',''),updated_at=now()
      where lead_id=p_lead_id and passenger_code=v_lead.codigo||'-P'||lpad(v_index::text,2,'0');
    end loop;
  end if;
  return jsonb_build_object('lead_id',p_lead_id,'sales_stage',(select sales_stage from public.leads where id=p_lead_id));
end $$;
revoke all on function public.update_link_sales_flow(uuid,jsonb) from public;
grant execute on function public.update_link_sales_flow(uuid,jsonb) to authenticated;

create or replace function public.create_link_quote_snapshot(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_role text; v_lead public.leads%rowtype; v_version integer;
  v_quote public.sales_quotes%rowtype; v_policy public.cancellation_policies%rowtype; v_items jsonb; v_total numeric;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to create quote'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then raise exception 'Lead not found'; end if;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then raise exception 'No puedes cotizar un ingreso asignado a otro vendedor'; end if;
  select * into v_policy from public.cancellation_policies where status='active' and is_default=true and (effective_from is null or effective_from<=current_date) and (effective_to is null or effective_to>=current_date) order by priority desc,version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'service_id',s.id,'product_catalog_id',s.product_catalog_id,'product_code',coalesce(pc.code,s.tour_id),
    'product_name',s.producto,'category',coalesce(pc.category,s.service_type),'service_type',s.service_type,
    'service_date',s.fecha_servicio,'start_time',s.hora_inicio,'pax',s.numero_pax,'modality',s.modality,
    'unit_price',s.precio_unitario,'total_price',coalesce(s.precio_total,s.precio_venta,0),
    'catalog_price_mode',pc.price_mode,'catalog_prices',pc.prices,'description',pc.description,'schedule',pc.schedule,
    'duration_hours',pc.duration_hours,'notes',s.observacion
  ) order by s.created_at,s.id),'[]'::jsonb),coalesce(sum(coalesce(s.precio_total,s.precio_venta,0)),0)
  into v_items,v_total from public.lead_services s left join public.product_catalog pc on pc.id=s.product_catalog_id
  where s.lead_id=p_lead_id and s.booking_status='quoted';
  if jsonb_array_length(v_items)=0 then raise exception 'Agrega al menos un producto antes de generar la cotización'; end if;
  select coalesce(max(version),0)+1 into v_version from public.sales_quotes where lead_id=p_lead_id;
  insert into public.sales_quotes(quote_code,lead_id,version,status,snapshot,policy_summary,total,currency,created_by)
  values('COT-'||v_lead.codigo||'-V'||v_version,p_lead_id,v_version,'draft',jsonb_build_object(
    'lead',jsonb_build_object('code',v_lead.codigo,'reference',v_lead.reservation_reference,'contact',v_lead.contacto,'pax',v_lead.numero_pax,'checkin',v_lead.checkin,'checkout',v_lead.checkout,'nationality',v_lead.nationality,'hotel_partner_id',v_lead.hotel_partner_id),
    'items',v_items,'policy',case when v_policy.id is null then null else jsonb_build_object('id',v_policy.id,'key',v_policy.policy_key,'version',v_policy.version,'name',v_policy.name,'summary',v_policy.normalized_summary) end
  ),v_policy.normalized_summary,v_total,'CLP',v_user) returning * into v_quote;
  update public.leads set sales_stage='quote_ready',updated_at=now() where id=p_lead_id;
  return jsonb_build_object('id',v_quote.id,'quote_code',v_quote.quote_code,'version',v_quote.version,'status',v_quote.status,'snapshot',v_quote.snapshot,'policy_summary',v_quote.policy_summary,'total',v_quote.total,'currency',v_quote.currency);
end $$;
revoke all on function public.create_link_quote_snapshot(uuid) from public;
grant execute on function public.create_link_quote_snapshot(uuid) to authenticated;

create or replace function public.mark_link_quote_status(p_quote_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_role text; v_quote public.sales_quotes%rowtype; v_lead public.leads%rowtype;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to update quote'; end if;
  select * into v_quote from public.sales_quotes where id=p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  select * into v_lead from public.leads where id=v_quote.lead_id;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then raise exception 'No puedes modificar esta cotización'; end if;
  if p_status not in ('draft','sent','accepted') then raise exception 'Invalid quote status'; end if;
  update public.sales_quotes set status=p_status,sent_at=case when p_status in ('sent','accepted') then coalesce(sent_at,now()) else sent_at end,accepted_at=case when p_status='accepted' then coalesce(accepted_at,now()) else accepted_at end where id=p_quote_id returning * into v_quote;
  if p_status='sent' then
    update public.leads set propuesta_enviada='Enviada',estado='propuesta',commercial_status='proposal_sent',sales_stage='quote_sent',quote_sent_at=coalesce(quote_sent_at,now()),next_best_action='Esperar aceptación del cliente',updated_at=now() where id=v_quote.lead_id;
  elsif p_status='accepted' then
    update public.leads set estado='esperando',commercial_status='accepted',sales_stage='accepted_payment',quote_sent_at=coalesce(quote_sent_at,now()),quote_accepted_at=coalesce(quote_accepted_at,now()),next_best_action='Enviar link de pago y completar datos',updated_at=now() where id=v_quote.lead_id;
  end if;
  return jsonb_build_object('id',v_quote.id,'status',v_quote.status,'lead_id',v_quote.lead_id);
end $$;
revoke all on function public.mark_link_quote_status(uuid,text) from public;
grant execute on function public.mark_link_quote_status(uuid,text) to authenticated;
