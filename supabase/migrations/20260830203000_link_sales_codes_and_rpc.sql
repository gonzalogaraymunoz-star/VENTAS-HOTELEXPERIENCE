-- LINK Ventas: extensión mínima sobre el Supabase existente de HOTEL EXPERIENCE.
-- No crea una base paralela. Agrega códigos legibles a servicios/pagos/comisiones
-- y un RPC transaccional para crear una venta completa.

alter table public.lead_services add column if not exists service_code text;
alter table public.payment_movements add column if not exists payment_code text;
alter table public.service_commissions add column if not exists commission_code text;

create unique index if not exists lead_services_service_code_uidx
  on public.lead_services(service_code) where service_code is not null;
create unique index if not exists payment_movements_payment_code_uidx
  on public.payment_movements(payment_code) where payment_code is not null;
create unique index if not exists service_commissions_commission_code_uidx
  on public.service_commissions(commission_code) where commission_code is not null;

create or replace function public.assign_link_service_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_code text;
  v_number integer;
begin
  if coalesce(btrim(new.service_code),'') <> '' then
    return new;
  end if;

  perform 1 from public.leads where id = new.lead_id for update;
  select codigo into v_lead_code from public.leads where id = new.lead_id;
  if coalesce(v_lead_code,'') = '' then
    raise exception 'Lead code is required before assigning a service code';
  end if;

  select coalesce(max(nullif(regexp_replace(service_code, '^.*-S', ''), '')::integer), 0) + 1
    into v_number
  from public.lead_services
  where lead_id = new.lead_id and service_code ~ '-S[0-9]+$';

  new.service_code := v_lead_code || '-S' || lpad(v_number::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_link_service_code on public.lead_services;
create trigger trg_assign_link_service_code
before insert on public.lead_services
for each row execute function public.assign_link_service_code();

create or replace function public.assign_link_payment_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_code text;
  v_number integer;
begin
  if coalesce(btrim(new.payment_code),'') <> '' or new.lead_service_id is null then
    return new;
  end if;

  perform 1 from public.lead_services where id = new.lead_service_id for update;
  select service_code into v_service_code from public.lead_services where id = new.lead_service_id;
  if coalesce(v_service_code,'') = '' then
    return new;
  end if;

  select coalesce(max(nullif(regexp_replace(payment_code, '^.*-PG', ''), '')::integer), 0) + 1
    into v_number
  from public.payment_movements
  where lead_service_id = new.lead_service_id and payment_code ~ '-PG[0-9]+$';

  new.payment_code := v_service_code || '-PG' || lpad(v_number::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_link_payment_code on public.payment_movements;
create trigger trg_assign_link_payment_code
before insert on public.payment_movements
for each row execute function public.assign_link_payment_code();

create or replace function public.assign_link_commission_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_code text;
  v_number integer;
begin
  if coalesce(btrim(new.commission_code),'') <> '' then
    return new;
  end if;

  perform 1 from public.lead_services where id = new.lead_service_id for update;
  select service_code into v_service_code from public.lead_services where id = new.lead_service_id;
  if coalesce(v_service_code,'') = '' then
    return new;
  end if;

  select coalesce(max(nullif(regexp_replace(commission_code, '^.*-CM', ''), '')::integer), 0) + 1
    into v_number
  from public.service_commissions
  where lead_service_id = new.lead_service_id and commission_code ~ '-CM[0-9]+$';

  new.commission_code := v_service_code || '-CM' || lpad(v_number::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_link_commission_code on public.service_commissions;
create trigger trg_assign_link_commission_code
before insert on public.service_commissions
for each row execute function public.assign_link_commission_code();

-- Backfill de códigos para registros anteriores sin tocar su identidad UUID.
with ranked as (
  select ls.id, l.codigo,
         row_number() over (partition by ls.lead_id order by ls.created_at, ls.id) as rn
  from public.lead_services ls
  join public.leads l on l.id = ls.lead_id
  where ls.service_code is null
)
update public.lead_services ls
set service_code = ranked.codigo || '-S' || lpad(ranked.rn::text, 2, '0')
from ranked
where ls.id = ranked.id;

with ranked as (
  select pm.id, ls.service_code,
         row_number() over (partition by pm.lead_service_id order by pm.created_at, pm.id) as rn
  from public.payment_movements pm
  join public.lead_services ls on ls.id = pm.lead_service_id
  where pm.payment_code is null and pm.lead_service_id is not null and ls.service_code is not null
)
update public.payment_movements pm
set payment_code = ranked.service_code || '-PG' || lpad(ranked.rn::text, 2, '0')
from ranked
where pm.id = ranked.id;

with ranked as (
  select sc.id, ls.service_code,
         row_number() over (partition by sc.lead_service_id order by sc.created_at, sc.id) as rn
  from public.service_commissions sc
  join public.lead_services ls on ls.id = sc.lead_service_id
  where sc.commission_code is null and ls.service_code is not null
)
update public.service_commissions sc
set commission_code = ranked.service_code || '-CM' || lpad(ranked.rn::text, 2, '0')
from ranked
where sc.id = ranked.id;

create or replace function public.create_link_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_service public.lead_services%rowtype;
  v_passenger jsonb;
  v_product jsonb;
  v_hotel_name text;
  v_passenger_index integer := 0;
  v_total numeric := 0;
  v_service_names text[] := '{}';
begin
  v_role := public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to create sales';
  end if;

  if nullif(p_payload->>'hotel_partner_id','') is null then
    raise exception 'hotel_partner_id is required';
  end if;

  select name into v_hotel_name
  from public.hotel_partners
  where id = (p_payload->>'hotel_partner_id')::uuid and active = true;

  if v_hotel_name is null then
    raise exception 'Hotel partner not found or inactive';
  end if;

  if jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb)) = 0 then
    raise exception 'At least one passenger is required';
  end if;

  if jsonb_array_length(coalesce(p_payload->'services','[]'::jsonb)) = 0 then
    raise exception 'At least one service is required';
  end if;

  insert into public.leads (
    codigo, reserva, numero_pax, servicio, precio_venta, moneda,
    checkin, checkout, contacto, observaciones_cobros, prioridad,
    estado, canal, created_by, assigned_to, hotel_partner_id,
    lifecycle_stage, commercial_status, next_best_action
  ) values (
    'PENDIENTE',
    'PENDIENTE',
    jsonb_array_length(p_payload->'passengers'),
    'Venta LINK',
    0,
    'CLP',
    nullif(p_payload->>'checkin','')::date,
    nullif(p_payload->>'checkout','')::date,
    nullif(p_payload->>'contact',''),
    nullif(p_payload->>'notes',''),
    coalesce(nullif(p_payload->>'priority',''),'Media'),
    'confirmado',
    coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
    v_user,
    v_user,
    (p_payload->>'hotel_partner_id')::uuid,
    'active',
    'won',
    'Enviar a operación'
  ) returning * into v_lead;

  update public.leads set reserva = v_lead.codigo where id = v_lead.id;
  v_lead.reserva := v_lead.codigo;

  for v_passenger in
    select value from jsonb_array_elements(p_payload->'passengers')
  loop
    v_passenger_index := v_passenger_index + 1;
    insert into public.passengers (
      lead_id, passenger_code, full_name, email, phone, nationality,
      document_type, document_number, birth_date, dietary_restrictions,
      is_primary, created_by
    ) values (
      v_lead.id,
      v_lead.codigo || '-P' || lpad(v_passenger_index::text, 2, '0'),
      coalesce(nullif(v_passenger->>'full_name',''), 'Pasajero ' || v_passenger_index),
      nullif(v_passenger->>'email',''),
      nullif(v_passenger->>'phone',''),
      nullif(v_passenger->>'nationality',''),
      nullif(v_passenger->>'document_type',''),
      nullif(v_passenger->>'document_number',''),
      nullif(v_passenger->>'birth_date','')::date,
      nullif(v_passenger->>'dietary_restrictions',''),
      case when v_passenger_index = 1 then true else coalesce((v_passenger->>'is_primary')::boolean,false) end,
      v_user
    );
  end loop;

  for v_product in
    select value from jsonb_array_elements(p_payload->'services')
  loop
    insert into public.lead_services (
      lead_id, producto, fecha_servicio, numero_pax, observacion,
      precio_venta, moneda, estado_pago, estado_operacion,
      tour_id, modality, pricing_status, price_pp_clp, pricing_source,
      service_type, seller_name, costo_operador_total, booking_status,
      sales_channel, hora_inicio, precio_unitario, precio_total,
      margen_comercial, comision_hotel, comision_vendedor,
      margen_hotel_experience, horario_confirmado, requiere_confirmacion
    ) values (
      v_lead.id,
      v_product->>'product_name',
      nullif(v_product->>'date','')::date,
      coalesce((v_product->>'pax')::integer,1),
      nullif(v_product->>'notes',''),
      coalesce((v_product->>'total_price')::numeric,0),
      'CLP',
      'Pendiente',
      'Pendiente',
      nullif(v_product->>'product_code',''),
      nullif(v_product->>'modality',''),
      'confirmed',
      nullif(v_product->>'unit_price','')::numeric,
      'LINK Ventas / product_catalog',
      nullif(v_product->>'category',''),
      nullif(p_payload->>'seller_name',''),
      coalesce((v_product->>'operator_cost')::numeric,0),
      'confirmed',
      coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
      nullif(v_product->>'start_time','')::time,
      nullif(v_product->>'unit_price','')::numeric,
      coalesce((v_product->>'total_price')::numeric,0),
      coalesce((v_product->>'margin')::numeric,0),
      coalesce((v_product->>'hotel_commission')::numeric,0),
      coalesce((v_product->>'seller_commission')::numeric,0),
      coalesce((v_product->>'platform_margin')::numeric,0),
      case when nullif(v_product->>'start_time','') is null then false else true end,
      case when nullif(v_product->>'start_time','') is null then true else false end
    ) returning * into v_service;

    v_total := v_total + coalesce(v_service.precio_total, v_service.precio_venta, 0);
    v_service_names := array_append(v_service_names, v_service.producto);

    if nullif(v_product->>'supplier_id','') is not null then
      insert into public.service_assignments (
        lead_service_id, supplier_id, supplier_cost,
        supplier_payment_status, created_by, updated_by,
        operation_mode, notes
      ) values (
        v_service.id,
        (v_product->>'supplier_id')::uuid,
        coalesce((v_product->>'operator_cost')::numeric,0),
        'Pendiente',
        v_user,
        v_user,
        'delegated_full',
        'Operador propuesto desde LINK Ventas; Operaciones debe validar la asignación.'
      );
    end if;

    if coalesce((v_product->>'hotel_commission')::numeric,0) > 0 then
      insert into public.service_commissions (
        lead_service_id, actor_type, actor_name, percentage, amount,
        calculation_basis, status, notes
      ) values (
        v_service.id, 'hotel', v_hotel_name,
        nullif(v_product->>'hotel_commission_pct','')::numeric,
        (v_product->>'hotel_commission')::numeric,
        'margin', 'pending', 'Generada por LINK Ventas'
      );
    end if;

    if coalesce((v_product->>'seller_commission')::numeric,0) > 0 then
      insert into public.service_commissions (
        lead_service_id, actor_type, actor_name, percentage, amount,
        calculation_basis, status, notes
      ) values (
        v_service.id, 'seller', nullif(p_payload->>'seller_name',''),
        nullif(v_product->>'seller_commission_pct','')::numeric,
        (v_product->>'seller_commission')::numeric,
        'margin', 'pending', 'Generada por LINK Ventas'
      );
    end if;

    if coalesce((v_product->>'platform_margin')::numeric,0) > 0 then
      insert into public.service_commissions (
        lead_service_id, actor_type, actor_name, amount,
        calculation_basis, status, notes
      ) values (
        v_service.id, 'platform', 'HOTEL EXPERIENCE / LINK',
        (v_product->>'platform_margin')::numeric,
        'margin', 'pending', 'Margen remanente después de costo operador, hotel y vendedor'
      );
    end if;
  end loop;

  update public.leads
  set servicio = array_to_string(v_service_names, ' + '),
      precio_venta = v_total,
      numero_pax = jsonb_array_length(p_payload->'passengers'),
      updated_at = now()
  where id = v_lead.id;

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'lead_code', v_lead.codigo,
    'reservation_code', v_lead.codigo
  );
end;
$$;

revoke all on function public.create_link_sale(jsonb) from public;
grant execute on function public.create_link_sale(jsonb) to authenticated;

comment on function public.create_link_sale(jsonb) is
'Atomic sales handoff for LINK Ventas: Lead -> Passengers -> Services -> optional operator assignment -> commissions.';
