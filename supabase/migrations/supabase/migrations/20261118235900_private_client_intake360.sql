-- Ficha 360 approved scope: same CRM tables and audience. Additive schema.
-- Deployment gate: approve scope, review exact live trigger definition, test transaction
-- against a non-production copy, and verify unauthenticated reads remain denied.
begin;
alter table public.leads add column if not exists intake_request jsonb;
comment on column public.leads.intake_request is 'Partial customer request before quotation. Unknown values remain JSON null. No confirmed service or pricing entry is created.';

-- Preserve the normal rule outside the explicitly partial ficha mode.
create or replace function public.ensure_primary_passenger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.leads where id=new.lead_id and intake_request->>'principal_pending'='true') then
    new.is_primary:=false;
    return new;
  end if;
  if new.is_primary=true then
    update public.passengers set is_primary=false,updated_at=now()
    where lead_id=new.lead_id and id is distinct from new.id
      and passenger_code is distinct from new.passenger_code and is_primary=true;
  elsif not exists(select 1 from public.passengers where lead_id=new.lead_id and is_primary=true and passenger_code is distinct from new.passenger_code) then
    new.is_primary:=true;
  end if;
  return new;
end $$;

create or replace function public.save_link_client_intake360(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_role text:=public.current_user_role();
  v_id uuid:=coalesce(nullif(p_payload->>'lead_id','')::uuid,nullif(p_payload->>'request_id','')::uuid);
  v_lead public.leads%rowtype;
  v_person jsonb;
  v_person_id uuid;
  v_index integer;
  v_code text;
  v_people jsonb:=coalesce(p_payload->'passengers','[]'::jsonb);
  v_request jsonb:=coalesce(p_payload->'request','{}'::jsonb);
  v_primary integer;
  v_hotel uuid:=nullif(p_payload->>'hotel_partner_id','')::uuid;
  v_seller uuid:=nullif(p_payload->>'seller_profile_id','')::uuid;
  v_seen uuid[]:='{}';
begin
  if v_user is null or v_role is null or v_role not in ('admin','manager','agent')
    or not exists(select 1 from public.profiles where id=v_user and is_active=true) then
    raise exception 'No autorizado';
  end if;
  if octet_length(p_payload::text)>200000 then raise exception 'Ficha demasiado extensa'; end if;
  if v_hotel is not null and not exists(select 1 from public.hotel_partners where id=v_hotel and active=true) then raise exception 'Origen no válido'; end if;
  if v_seller is not null and not exists(select 1 from public.profiles where id=v_seller and is_active=true and role in ('admin','manager','agent')) then raise exception 'Responsable no válido'; end if;
  if v_id is null then raise exception 'Falta identificador de solicitud'; end if;
  if jsonb_typeof(v_people)<>'array' or jsonb_array_length(v_people)>100 then raise exception 'Lista de pasajeros no válida'; end if;
  if not exists(select 1 from jsonb_array_elements(v_people) p where nullif(btrim(p->>'full_name'),'') is not null)
    and nullif(btrim(p_payload->>'contact'),'') is null then raise exception 'Completa nombre o contacto'; end if;
  if exists(select 1 from jsonb_array_elements(v_people) p where nullif(btrim(p->>'full_name'),'') is null) then raise exception 'Pasajero sin nombre'; end if;
  select count(*) into v_primary from jsonb_array_elements(v_people) p where p->>'is_primary'='true';
  if v_primary>1 then raise exception 'Sólo puede haber un pasajero principal'; end if;
  if v_request->>'pax' is not null and ((v_request->>'pax')::numeric<1 or trunc((v_request->>'pax')::numeric)<>(v_request->>'pax')::numeric) then raise exception 'Cantidad de pasajeros no válida'; end if;
  if nullif(v_request->>'date','') is not null then perform (v_request->>'date')::date; end if;
  if nullif(v_request->>'time','') is not null then perform (v_request->>'time')::time; end if;
  if v_request->>'agreedPrice' is not null and (v_request->>'agreedPrice')::numeric<0 then raise exception 'Tarifa no válida'; end if;
  -- Whitelist request fields. No external routing, operational status, or user-supplied role.
  v_request:=jsonb_build_object('product',v_request->'product','modality',v_request->'modality',
    'pax',v_request->'pax','date',v_request->'date','time',v_request->'time',
    'pickup',v_request->'pickup','language',v_request->'language',
    'agreedPrice',v_request->'agreedPrice','currency',nullif(btrim(v_request->>'currency'),''),'sourceNote',v_request->'sourceNote',
    'principal_pending',v_primary=0);
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
  select * into v_lead from public.leads where id=v_id for update;
  if not found then
    if nullif(p_payload->>'lead_id','') is not null then raise exception 'Ficha no encontrada'; end if;
    if v_role='agent' and v_seller is not null and v_seller<>v_user then raise exception 'No puedes asignar a otro vendedor'; end if;
    v_code:='F360-'||replace(v_id::text,'-','');
    insert into public.leads(id,codigo,reserva,precio_venta,moneda,estado,lifecycle_stage,
      created_by,assigned_to,hotel_partner_id,contacto,intake_request)
    values(v_id,v_code,v_code,null,coalesce(nullif(v_request->>'currency',''),'PENDIENTE'),'nuevo','commercial',
      v_user,v_seller,v_hotel,nullif(btrim(p_payload->>'contact'),''),v_request)
    returning * into v_lead;
  else
    if v_role='agent' and v_user is distinct from v_lead.created_by and v_user is distinct from v_lead.assigned_to then raise exception 'Sin acceso al expediente'; end if;
    if v_lead.estado='confirmado' or exists(select 1 from public.lead_services where lead_id=v_id and booking_status in ('confirmed','completed')) then raise exception 'La ficha parcial no modifica reservas confirmadas'; end if;
    if nullif(p_payload->>'expected_updated_at','') is null
      or (p_payload->>'expected_updated_at')::timestamptz is distinct from v_lead.updated_at then
      raise exception 'La ficha cambió. Recarga antes de guardar para no sobrescribir datos';
    end if;
    if v_role='agent' and v_seller is distinct from v_lead.assigned_to and v_seller is not null and v_seller<>v_user then raise exception 'No puedes asignar a otro vendedor'; end if;
    update public.leads set hotel_partner_id=v_hotel,assigned_to=v_seller,contacto=nullif(btrim(p_payload->>'contact'),''),intake_request=v_request
    where id=v_id returning * into v_lead;
  end if;
  -- Lock and validate all existing people before any trigger can update their timestamps.
  perform 1 from public.passengers where lead_id=v_id order by id for update;
  for v_person in select value from jsonb_array_elements(v_people) loop
    if nullif(v_person->>'id','') is not null and not exists(
      select 1 from public.passengers where id=(v_person->>'id')::uuid and lead_id=v_id
      and updated_at=nullif(v_person->>'expected_updated_at','')::timestamptz
    ) then raise exception 'El pasajero cambió. Recarga antes de guardar'; end if;
  end loop;
  if v_primary=0 then update public.passengers set is_primary=false where lead_id=v_id and is_primary=true; end if;
  -- Preserve IDs and passenger codes. Never remove people, services, or links.
  select coalesce(max(substring(passenger_code from '-P([0-9]+)$')::integer),0) into v_index
    from public.passengers where lead_id=v_id;
  for v_person in select value from jsonb_array_elements(v_people) loop
    v_person_id:=nullif(v_person->>'id','')::uuid;
    if v_person_id is not null then
      if not exists(select 1 from public.passengers where id=v_person_id and lead_id=v_id) then raise exception 'Pasajero ajeno al expediente'; end if;
      if v_person_id=any(v_seen) then raise exception 'Pasajero repetido'; end if;
    else
      v_index:=v_index+1; v_person_id:=gen_random_uuid();
      insert into public.passengers(id,lead_id,passenger_code,full_name,is_primary,created_by)
      values(v_person_id,v_id,'F360-'||replace(v_person_id::text,'-',''),btrim(v_person->>'full_name'),false,v_user);
    end if;
    v_seen:=array_append(v_seen,v_person_id);
    update public.passengers set full_name=btrim(v_person->>'full_name'),
      email=nullif(btrim(v_person->>'email'),''),phone=nullif(btrim(v_person->>'phone'),''),
      nationality=nullif(btrim(v_person->>'nationality'),''),document_type=nullif(btrim(v_person->>'document_type'),''),
      document_number=nullif(btrim(v_person->>'document_number'),''),birth_date=nullif(v_person->>'birth_date','')::date,
      dietary_restrictions=nullif(btrim(v_person->>'dietary_restrictions'),''),medical_notes=nullif(btrim(v_person->>'medical_notes'),''),
      disability_type=nullif(btrim(v_person->>'disability_type'),''),is_primary=coalesce((v_person->>'is_primary')::boolean,false)
    where id=v_person_id and lead_id=v_id;
  end loop;
  -- No services, payments, capacity, Drive, client messages, or sales_stage mutations.
  return jsonb_build_object('lead_id',v_id,'lead_code',v_lead.codigo,'passengers_updated',jsonb_array_length(v_people));
end $$;
revoke all on function public.save_link_client_intake360(jsonb) from public,anon;
grant execute on function public.save_link_client_intake360(jsonb) to authenticated;
commit;
