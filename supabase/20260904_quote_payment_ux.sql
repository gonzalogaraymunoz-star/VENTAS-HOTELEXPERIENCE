-- LINK Ventas · 2026-09-04
-- Keeps payment coordination truthful (link sent vs. coordinated externally)
-- and carries catalog details into immutable quote snapshots.

alter table public.leads
  add column if not exists payment_coordination_status text not null default 'pending',
  add column if not exists payment_coordination_at timestamptz,
  add column if not exists payment_coordination_note text;

create or replace function public.update_link_sales_flow(p_lead_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_passenger jsonb;
  v_index integer:=0;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to update sales flow';
  end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then
    raise exception 'No puedes modificar un ingreso asignado a otro vendedor';
  end if;

  update public.leads set
    reservation_reference=case when p_payload ? 'reservation_reference' then nullif(p_payload->>'reservation_reference','') else reservation_reference end,
    sales_stage=case when p_payload ? 'sales_stage' then coalesce(nullif(p_payload->>'sales_stage',''),sales_stage) else sales_stage end,
    payment_link=case when p_payload ? 'payment_link' then nullif(p_payload->>'payment_link','') else payment_link end,
    payment_coordination_status=case when p_payload ? 'payment_coordination_status' then coalesce(nullif(p_payload->>'payment_coordination_status',''),'pending') else payment_coordination_status end,
    payment_coordination_note=case when p_payload ? 'payment_coordination_note' then nullif(p_payload->>'payment_coordination_note','') else payment_coordination_note end,
    payment_coordination_at=case when p_payload ? 'payment_coordination_status' and coalesce(nullif(p_payload->>'payment_coordination_status',''),'pending')<>'pending' then now() else payment_coordination_at end,
    arrival_flight_number=case when p_payload ? 'arrival_flight_number' then nullif(p_payload->>'arrival_flight_number','') else arrival_flight_number end,
    departure_flight_number=case when p_payload ? 'departure_flight_number' then nullif(p_payload->>'departure_flight_number','') else departure_flight_number end,
    pickup_location=case when p_payload ? 'pickup_location' then nullif(p_payload->>'pickup_location','') else pickup_location end,
    hotel_room=case when p_payload ? 'hotel_room' then nullif(p_payload->>'hotel_room','') else hotel_room end,
    quote_sent_at=case when coalesce((p_payload->>'mark_quote_sent')::boolean,false) then now() else quote_sent_at end,
    quote_accepted_at=case when coalesce((p_payload->>'mark_quote_accepted')::boolean,false) then now() else quote_accepted_at end,
    payment_link_sent_at=case when coalesce((p_payload->>'mark_payment_link_sent')::boolean,false) then now() else payment_link_sent_at end,
    itinerary_sent_at=case when coalesce((p_payload->>'mark_itinerary_sent')::boolean,false) then now() else itinerary_sent_at end,
    itinerary_sent_via=case when coalesce((p_payload->>'mark_itinerary_sent')::boolean,false) then coalesce(nullif(p_payload->>'itinerary_sent_via',''),'email') else itinerary_sent_via end,
    reservation_completed_at=case when coalesce((p_payload->>'mark_completed')::boolean,false) then now() else reservation_completed_at end,
    updated_at=now()
  where id=p_lead_id;

  if p_payload ? 'passengers' then
    for v_passenger in select value from jsonb_array_elements(coalesce(p_payload->'passengers','[]'::jsonb)) loop
      v_index:=v_index+1;
      update public.passengers set
        medical_notes=nullif(v_passenger->>'medical_notes',''),
        dietary_restrictions=nullif(v_passenger->>'dietary_restrictions',''),
        updated_at=now()
      where lead_id=p_lead_id
        and passenger_code=v_lead.codigo||'-P'||lpad(v_index::text,2,'0');
    end loop;
  end if;

  return jsonb_build_object(
    'lead_id',p_lead_id,
    'sales_stage',(select sales_stage from public.leads where id=p_lead_id),
    'payment_coordination_status',(select payment_coordination_status from public.leads where id=p_lead_id)
  );
end;
$function$;

create or replace function public.create_link_quote_snapshot(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_version integer;
  v_quote public.sales_quotes%rowtype;
  v_policy public.cancellation_policies%rowtype;
  v_items jsonb;
  v_total numeric;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to create quote'; end if;
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then raise exception 'Lead not found'; end if;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then raise exception 'No puedes cotizar un ingreso asignado a otro vendedor'; end if;

  select * into v_policy from public.cancellation_policies
  where status='active' and is_default=true
    and (effective_from is null or effective_from<=current_date)
    and (effective_to is null or effective_to>=current_date)
  order by priority desc, version desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'service_id',s.id,
    'product_catalog_id',s.product_catalog_id,
    'product_code',coalesce(pc.code,s.tour_id),
    'product_name',s.producto,
    'category',coalesce(pc.category,s.service_type),
    'service_type',s.service_type,
    'service_date',s.fecha_servicio,
    'start_time',s.hora_inicio,
    'end_time',s.hora_fin,
    'pax',s.numero_pax,
    'modality',s.modality,
    'unit_price',s.precio_unitario,
    'total_price',coalesce(s.precio_total,s.precio_venta,0),
    'catalog_price_mode',pc.price_mode,
    'catalog_prices',pc.prices,
    'description',pc.description,
    'schedule',pc.schedule,
    'duration_hours',pc.duration_hours,
    'stops',pc.stops,
    'snack',pc.snack,
    'notes',s.observacion
  ) order by s.fecha_servicio nulls last,s.hora_inicio nulls last,s.created_at,s.id),'[]'::jsonb),
  coalesce(sum(coalesce(s.precio_total,s.precio_venta,0)),0)
  into v_items,v_total
  from public.lead_services s
  left join public.product_catalog pc on pc.id=s.product_catalog_id
  where s.lead_id=p_lead_id and s.booking_status='quoted';

  if jsonb_array_length(v_items)=0 then raise exception 'Agrega al menos un producto antes de generar la cotización'; end if;
  select coalesce(max(version),0)+1 into v_version from public.sales_quotes where lead_id=p_lead_id;

  insert into public.sales_quotes(quote_code,lead_id,version,status,snapshot,policy_summary,total,currency,created_by)
  values(
    'COT-'||v_lead.codigo||'-V'||v_version,
    p_lead_id,v_version,'draft',
    jsonb_build_object(
      'lead',jsonb_build_object(
        'code',v_lead.codigo,'reference',v_lead.reservation_reference,'contact',v_lead.contacto,
        'pax',v_lead.numero_pax,'checkin',v_lead.checkin,'checkout',v_lead.checkout,
        'nationality',v_lead.nationality,'hotel_partner_id',v_lead.hotel_partner_id
      ),
      'items',v_items,
      'policy',case when v_policy.id is null then null else jsonb_build_object(
        'id',v_policy.id,'key',v_policy.policy_key,'version',v_policy.version,
        'name',v_policy.name,'summary',v_policy.normalized_summary
      ) end
    ),
    v_policy.normalized_summary,v_total,'CLP',v_user
  ) returning * into v_quote;

  update public.leads set sales_stage='quote_ready',updated_at=now() where id=p_lead_id;
  return jsonb_build_object(
    'id',v_quote.id,'quote_code',v_quote.quote_code,'version',v_quote.version,
    'status',v_quote.status,'snapshot',v_quote.snapshot,'policy_summary',v_quote.policy_summary,
    'total',v_quote.total,'currency',v_quote.currency
  );
end;
$function$;
