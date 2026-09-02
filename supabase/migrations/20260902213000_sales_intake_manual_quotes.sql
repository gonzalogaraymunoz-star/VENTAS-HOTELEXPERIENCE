-- LINK Ventas: ingreso flexible, prioridad por arribo y productos manuales.
-- Mantiene Supabase como fuente de verdad y no crea estructuras paralelas.

alter table public.leads add column if not exists nationality text;
alter table public.leads add column if not exists stay_days integer;

alter table public.leads drop constraint if exists leads_stay_days_nonnegative;
alter table public.leads add constraint leads_stay_days_nonnegative
  check (stay_days is null or stay_days >= 0);

create or replace function public.create_link_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_service public.lead_services%rowtype;
  v_passenger jsonb;
  v_product jsonb;
  v_catalog public.product_catalog%rowtype;
  v_passenger_index integer:=0;
  v_passenger_count integer:=jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb));
  v_service_count integer:=jsonb_array_length(coalesce(p_payload->'services','[]'::jsonb));
  v_total numeric:=0;
  v_service_names text[]:='{}';
  v_confirm boolean:=coalesce((p_payload->>'confirm_now')::boolean,false);
  v_seller uuid;
  v_seller_name text;
  v_catalog_id uuid;
  v_product_name text;
  v_product_code text;
  v_category text;
  v_tax_treatment text;
  v_tax_rate numeric;
  v_pricing_source text;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to create sales';
  end if;
  if nullif(p_payload->>'hotel_partner_id','') is null then
    raise exception 'hotel_partner_id is required';
  end if;
  if not exists(select 1 from public.hotel_partners where id=(p_payload->>'hotel_partner_id')::uuid and active=true) then
    raise exception 'Hotel partner not found or inactive';
  end if;
  if v_confirm and v_service_count=0 then
    raise exception 'Agrega al menos un producto antes de confirmar la venta';
  end if;

  v_seller:=coalesce(nullif(p_payload->>'seller_profile_id','')::uuid,v_user);
  select coalesce(full_name,email) into v_seller_name
  from public.profiles
  where id=v_seller and is_active=true and role in ('admin','manager','agent');
  if v_seller_name is null then raise exception 'Selecciona un vendedor válido'; end if;
  if v_role='agent' and v_seller<>v_user then raise exception 'Un vendedor no puede asignar la venta a otra persona'; end if;

  insert into public.leads(
    codigo,reserva,numero_pax,servicio,precio_venta,moneda,
    checkin,checkout,contacto,nationality,stay_days,
    observaciones_cobros,propuesta_enviada,prioridad,estado,canal,
    created_by,assigned_to,hotel_partner_id,lifecycle_stage,commercial_status,next_best_action
  )
  values(
    'PENDIENTE','PENDIENTE',greatest(1,v_passenger_count),'Ingreso LINK',0,'CLP',
    nullif(p_payload->>'checkin','')::date,
    nullif(p_payload->>'checkout','')::date,
    nullif(p_payload->>'contact',''),
    nullif(p_payload->>'nationality',''),
    coalesce(
      nullif(p_payload->>'stay_days','')::integer,
      case
        when nullif(p_payload->>'checkin','') is not null and nullif(p_payload->>'checkout','') is not null
          then greatest(0,(nullif(p_payload->>'checkout','')::date-nullif(p_payload->>'checkin','')::date))
        else null
      end
    ),
    nullif(p_payload->>'notes',''),'Pendiente',coalesce(nullif(p_payload->>'priority',''),'Media'),
    'cotizando',coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
    v_user,v_seller,(p_payload->>'hotel_partner_id')::uuid,
    'commercial','quoting',case when v_service_count=0 then 'Completar datos y productos' else 'Enviar propuesta' end
  ) returning * into v_lead;

  update public.leads set reserva=v_lead.codigo where id=v_lead.id;
  v_lead.reserva:=v_lead.codigo;

  if v_passenger_count=0 then
    insert into public.passengers(
      lead_id,passenger_code,full_name,nationality,document_type,is_primary,created_by
    ) values(
      v_lead.id,v_lead.codigo||'-P01','Cliente por completar',nullif(p_payload->>'nationality',''),'Pasaporte',true,v_user
    );
    v_passenger_count:=1;
  else
    for v_passenger in select value from jsonb_array_elements(p_payload->'passengers') loop
      v_passenger_index:=v_passenger_index+1;
      insert into public.passengers(
        lead_id,passenger_code,full_name,email,phone,nationality,
        document_type,document_number,birth_date,dietary_restrictions,is_primary,created_by
      ) values(
        v_lead.id,
        v_lead.codigo||'-P'||lpad(v_passenger_index::text,2,'0'),
        coalesce(nullif(v_passenger->>'full_name',''),case when v_passenger_index=1 then 'Cliente por completar' else 'Acompañante '||v_passenger_index end),
        nullif(v_passenger->>'email',''),
        nullif(v_passenger->>'phone',''),
        coalesce(nullif(v_passenger->>'nationality',''),case when v_passenger_index=1 then nullif(p_payload->>'nationality','') else null end),
        coalesce(nullif(v_passenger->>'document_type',''),'Pasaporte'),
        nullif(v_passenger->>'document_number',''),
        nullif(v_passenger->>'birth_date','')::date,
        nullif(v_passenger->>'dietary_restrictions',''),
        case when v_passenger_index=1 then true else coalesce((v_passenger->>'is_primary')::boolean,false) end,
        v_user
      );
    end loop;
  end if;

  for v_product in select value from jsonb_array_elements(coalesce(p_payload->'services','[]'::jsonb)) loop
    v_catalog_id:=null;
    v_product_name:=null;
    v_product_code:=null;
    v_category:=null;
    v_tax_treatment:='manual';
    v_tax_rate:=null;
    v_pricing_source:='LINK Ventas / manual';

    if nullif(v_product->>'product_id','') is not null then
      select * into v_catalog from public.product_catalog
      where id=(v_product->>'product_id')::uuid and active=true;
      if not found then raise exception 'Producto de catálogo no encontrado o inactivo'; end if;
      v_catalog_id:=v_catalog.id;
      v_product_name:=v_catalog.name;
      v_product_code:=v_catalog.code;
      v_category:=v_catalog.category;
      v_tax_treatment:=coalesce(v_catalog.tax_treatment,'manual');
      v_tax_rate:=v_catalog.tax_rate;
      v_pricing_source:='LINK Ventas / product_catalog';
    else
      v_product_name:=coalesce(nullif(v_product->>'product_name',''),'Ítem manual');
      v_product_code:=coalesce(nullif(v_product->>'product_code',''),'MANUAL');
      v_category:=coalesce(nullif(v_product->>'category',''),'Manual');
    end if;

    if v_confirm and coalesce((v_product->>'total_price')::numeric,0)<=0 then
      raise exception 'No se puede confirmar un producto sin precio de venta';
    end if;

    insert into public.lead_services(
      lead_id,product_catalog_id,producto,fecha_servicio,numero_pax,observacion,
      precio_venta,moneda,estado_pago,estado_operacion,tour_id,modality,
      pricing_status,price_pp_clp,pricing_source,service_type,seller_name,
      costo_operador_total,booking_status,sales_channel,hora_inicio,
      precio_unitario,precio_total,margen_comercial,comision_hotel,
      comision_vendedor,margen_hotel_experience,horario_confirmado,
      requiere_confirmacion,proposed_supplier_id,tax_treatment_snapshot,tax_rate_snapshot
    ) values(
      v_lead.id,v_catalog_id,v_product_name,nullif(v_product->>'date','')::date,
      coalesce((v_product->>'pax')::integer,1),nullif(v_product->>'notes',''),
      coalesce((v_product->>'total_price')::numeric,0),'CLP','Pendiente','Pendiente',
      v_product_code,nullif(v_product->>'modality',''),'quoted',
      nullif(v_product->>'unit_price','')::numeric,v_pricing_source,v_category,v_seller_name,
      coalesce((v_product->>'operator_cost')::numeric,0),'quoted',
      coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
      nullif(v_product->>'start_time','')::time,
      nullif(v_product->>'unit_price','')::numeric,
      coalesce((v_product->>'total_price')::numeric,0),
      coalesce((v_product->>'margin')::numeric,0),
      coalesce((v_product->>'hotel_commission')::numeric,0),
      coalesce((v_product->>'seller_commission')::numeric,0),
      coalesce((v_product->>'platform_margin')::numeric,0),
      case when nullif(v_product->>'start_time','') is null then false else true end,
      case when nullif(v_product->>'start_time','') is null then true else false end,
      nullif(v_product->>'supplier_id','')::uuid,
      v_tax_treatment,v_tax_rate
    ) returning * into v_service;

    v_total:=v_total+coalesce(v_service.precio_total,v_service.precio_venta,0);
    v_service_names:=array_append(v_service_names,v_service.producto);
  end loop;

  update public.leads
  set servicio=case when v_service_count=0 then 'Sin producto definido' else array_to_string(v_service_names,' + ') end,
      precio_venta=v_total,
      numero_pax=greatest(1,v_passenger_count),
      updated_at=now()
  where id=v_lead.id;

  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(
    v_lead.id,
    case when v_service_count=0 then 'sales_intake_created' else 'quote_created' end,
    case when v_service_count=0 then 'Ingreso comercial creado' else 'Ingreso / venta creado' end,
    coalesce(v_service_count,0)||' producto(s) registrados. Datos de cliente y acompañantes pueden completarse antes de confirmar.',
    coalesce(v_user::text,'LINK Ventas')
  );

  if v_confirm then perform public.confirm_link_sale(v_lead.id); end if;

  return jsonb_build_object(
    'lead_id',v_lead.id,
    'lead_code',v_lead.codigo,
    'reservation_code',v_lead.codigo,
    'status',case when v_confirm then 'confirmed' else 'quoted' end
  );
end;
$$;

revoke all on function public.create_link_sale(jsonb) from public;
grant execute on function public.create_link_sale(jsonb) to authenticated;

comment on function public.create_link_sale(jsonb) is
'Flexible LINK sales intake: incomplete client -> optional manual/catalog items -> confirmed sale handoff.';
