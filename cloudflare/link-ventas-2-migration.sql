-- LINK Ventas 2.0 · migración aditiva aplicada a LINK CONTROL CENTRAL (2026-10-27).
-- Preserva tablas, identificadores y leads existentes. No usar con el Supabase heredado de Hotel Experience.
CREATE TABLE IF NOT EXISTS public.link_sales_members (
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','editor','viewer')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,user_id)
);
CREATE INDEX IF NOT EXISTS link_sales_members_user_idx ON public.link_sales_members(user_id,business_id);
ALTER TABLE public.link_sales_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_members_own_read ON public.link_sales_members;
CREATE POLICY link_sales_members_own_read ON public.link_sales_members FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON public.link_sales_members FROM anon,authenticated;
GRANT SELECT ON public.link_sales_members TO authenticated;
CREATE TABLE IF NOT EXISTS public.link_sales_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),
 description text,
 price numeric(14,2) NOT NULL DEFAULT 0 CHECK(price>=0),
 cost numeric(14,2) CHECK(cost IS NULL OR cost>=0),
 currency text NOT NULL DEFAULT 'CLP' CHECK(currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_sales_items_business_idx ON public.link_sales_items(business_id,status,created_at DESC);
ALTER TABLE public.link_sales_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_items_member_read ON public.link_sales_items;
CREATE POLICY link_sales_items_member_read ON public.link_sales_items FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.link_sales_members m WHERE m.business_id=link_sales_items.business_id AND m.user_id=(SELECT auth.uid()))
);
REVOKE ALL ON public.link_sales_items FROM anon,authenticated;
GRANT SELECT ON public.link_sales_items TO authenticated;
CREATE OR REPLACE FUNCTION public.link_sales_portal(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 v_uid uuid := auth.uid(); v_business uuid; v_name text; v_code text; v_role text; v_lead uuid; v_item uuid;
 v_price numeric; v_cost numeric; v_qty integer; v_currency text; v_version integer; v_amount numeric; v_control uuid; v_quote uuid; v_stage text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
 IF p_action='register_business' THEN
   v_name:=trim(coalesce(p_data->>'name',''));
   IF length(v_name) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Nombre de negocio inválido'; END IF;
   IF (SELECT count(*) FROM public.link_sales_members WHERE user_id=v_uid AND role='owner')>=3 THEN RAISE EXCEPTION 'Límite inicial de 3 negocios'; END IF;
   IF EXISTS(SELECT 1 FROM public.link_world_businesses WHERE lower(trim(name))=lower(v_name)) THEN RAISE EXCEPTION 'Ese negocio ya existe en LINK ID. Solicita vinculación; no lo dupliques.'; END IF;
   INSERT INTO public.link_world_businesses(name,slug,sector,created_from,created_by,verification_status,public_workspace)
   VALUES(v_name,coalesce(nullif(substr(trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g')),1,38),''),'negocio')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,7),
     'sin_clasificar','link_world_web',v_uid,'draft',false)
   RETURNING id,global_id INTO v_business,v_code;
   INSERT INTO public.link_sales_members(business_id,user_id,role) VALUES(v_business,v_uid,'owner');
   RETURN jsonb_build_object('ok',true,'business_id',v_business,'global_id',v_code);
 END IF;
 IF p_action='home' THEN
   v_business:=nullif(p_data->>'business_id','')::uuid;
   IF v_business IS NULL THEN SELECT business_id INTO v_business FROM public.link_sales_members WHERE user_id=v_uid ORDER BY created_at LIMIT 1; END IF;
   IF v_business IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.link_sales_members WHERE business_id=v_business AND user_id=v_uid) THEN RAISE EXCEPTION 'Sin acceso a este negocio'; END IF;
   RETURN jsonb_build_object(
    'ok',true,'selected_business_id',v_business,
    'businesses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'global_id',b.global_id,'role',m.role) ORDER BY b.name)
     FROM public.link_sales_members m JOIN public.link_world_businesses b ON b.id=m.business_id WHERE m.user_id=v_uid),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'description',i.description,'price',i.price,'cost',i.cost,'currency',i.currency,'status',i.status,'global_id',e.global_id) ORDER BY i.created_at DESC)
     FROM public.link_sales_items i LEFT JOIN public.ecosystem_entities e ON e.owner_domain='world' AND e.owner_table='link_sales_items' AND e.owner_record_id=i.id::text
     WHERE i.business_id=v_business),'[]'::jsonb),
    'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'full_name',x.full_name,'email',x.email,'phone',x.phone,'interested_product',x.interested_product,'message',x.message,'source',x.source,'stage',x.stage,'created_at',x.created_at,'updated_at',x.updated_at,'next_followup_at',x.next_followup_at,'metadata',x.metadata,'outcome',x.outcome,'lead_code',li.universal_code,'quote',x.q) ORDER BY x.created_at DESC)
      FROM (SELECT l.*, (SELECT jsonb_build_object('id',q.id,'version',q.version,'status',q.status,'quote_number',q.quote_number,'total_amount',q.total_amount,'currency',q.currency,'product_key',q.product_key,'snapshot',q.snapshot)
       FROM public.sales_quotes q WHERE q.lead_id=l.id ORDER BY q.version DESC LIMIT 1) q
       FROM public.sales_leads l WHERE l.business_id=v_business ORDER BY l.created_at DESC LIMIT 250) x
       LEFT JOIN public.link_lead_identities li ON li.lead_id=x.id),'[]'::jsonb)
   );
 END IF;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 IF v_business IS NULL THEN RAISE EXCEPTION 'Selecciona un negocio'; END IF;
 SELECT m.role INTO v_role FROM public.link_sales_members m WHERE m.business_id=v_business AND m.user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Sin acceso a este negocio'; END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'El rol lector no puede modificar'; END IF;
 IF p_action='create_product' THEN
   v_name:=trim(coalesce(p_data->>'name','')); v_price:=nullif(p_data->>'price','')::numeric;
   v_cost:=nullif(p_data->>'cost','')::numeric;
   v_currency:=upper(coalesce(nullif(trim(p_data->>'currency'),''),'CLP'));
   IF length(v_name) NOT BETWEEN 2 AND 160 OR v_price IS NULL OR v_price<0 OR v_price>100000000000 OR (v_cost IS NOT NULL AND (v_cost<0 OR v_cost>100000000000)) OR v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Producto, precio o moneda inválidos'; END IF;
   INSERT INTO public.link_sales_items(business_id,name,description,price,cost,currency,created_by)
   VALUES(v_business,v_name,nullif(left(trim(coalesce(p_data->>'description','')),1000),''),v_price,v_cost,v_currency,v_uid) RETURNING id INTO v_item;
   SELECT id INTO v_control FROM public.controls WHERE slug='link-control-central' LIMIT 1;
   INSERT INTO public.ecosystem_entities(entity_type,owner_domain,owner_table,owner_record_id,control_id,status,metadata)
   VALUES('product','world','link_sales_items',v_item::text,v_control,'active',jsonb_build_object('business_id',v_business,'registration','link-ventas-2'))
   RETURNING global_id INTO v_code;
   RETURN jsonb_build_object('ok',true,'product_id',v_item,'global_id',v_code);
 ELSIF p_action='update_product' THEN
   v_item:=nullif(p_data->>'product_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.link_sales_items WHERE id=v_item AND business_id=v_business) THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
   v_name:=trim(coalesce(p_data->>'name','')); v_price:=nullif(p_data->>'price','')::numeric;
   v_cost:=nullif(p_data->>'cost','')::numeric; v_currency:=upper(coalesce(nullif(trim(p_data->>'currency'),''),'CLP'));
   IF length(v_name) NOT BETWEEN 2 AND 160 OR v_price IS NULL OR v_price<0 OR v_price>100000000000 OR (v_cost IS NOT NULL AND (v_cost<0 OR v_cost>100000000000)) OR v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Datos de producto inválidos'; END IF;
   UPDATE public.link_sales_items SET name=v_name,description=nullif(left(trim(coalesce(p_data->>'description','')),1000),''),price=v_price,cost=v_cost,currency=v_currency,
    status=CASE WHEN p_data->>'status'='paused' THEN 'paused' ELSE 'active' END,updated_at=now()
    WHERE id=v_item AND business_id=v_business;
   RETURN jsonb_build_object('ok',true,'product_id',v_item);
 ELSIF p_action='create_lead' THEN
   v_name:=nullif(left(trim(coalesce(p_data->>'full_name','')),160),'');
   IF v_name IS NULL AND nullif(trim(coalesce(p_data->>'phone','')),'') IS NULL AND nullif(trim(coalesce(p_data->>'email','')),'') IS NULL THEN
    RAISE EXCEPTION 'Agrega nombre, correo o teléfono del contacto';
   END IF;
   v_item:=nullif(p_data->>'product_id','')::uuid;
   IF v_item IS NOT NULL THEN
     SELECT i.name INTO v_code FROM public.link_sales_items i WHERE i.id=v_item AND i.business_id=v_business;
     IF v_code IS NULL THEN RAISE EXCEPTION 'Producto no corresponde al negocio'; END IF;
   END IF;
   SELECT id INTO v_control FROM public.controls WHERE slug='link-control-central' LIMIT 1;
   IF v_control IS NULL THEN RAISE EXCEPTION 'LINK CONTROL CENTRAL no registrado'; END IF;
   INSERT INTO public.sales_leads(control_id,business_id,source,full_name,email,phone,interested_product,message,stage,metadata,next_followup_at)
   VALUES(v_control,v_business,coalesce(nullif(left(trim(p_data->>'source'),50),''),'link-ventas'),v_name,
    nullif(left(trim(p_data->>'email'),200),''),nullif(left(trim(p_data->>'phone'),80),''),
    coalesce(v_code,nullif(left(trim(p_data->>'interested_product'),160),'')),nullif(left(trim(p_data->>'message'),5000),''),'new',
    jsonb_build_object('entry','link-ventas-2','product_id',v_item,'human_reviewed',true),nullif(p_data->>'next_followup_at','')::timestamptz)
    RETURNING id INTO v_lead;
   SELECT universal_code INTO v_code FROM public.link_lead_identities WHERE lead_id=v_lead;
   RETURN jsonb_build_object('ok',true,'lead_id',v_lead,'lead_code',v_code);
 ELSIF p_action='set_stage' THEN
   v_lead:=nullif(p_data->>'lead_id','')::uuid; v_stage:=p_data->>'stage';
   IF v_stage NOT IN ('new','qualified','contacted','proposal','lost') THEN RAISE EXCEPTION 'Etapa inválida'; END IF;
   UPDATE public.sales_leads SET stage=v_stage,next_followup_at=nullif(p_data->>'next_followup_at','')::timestamptz,
    loss_reason=CASE WHEN v_stage='lost' THEN nullif(left(trim(p_data->>'reason'),500),'') ELSE loss_reason END
    WHERE id=v_lead AND business_id=v_business AND stage<>'won';
   IF NOT FOUND THEN RAISE EXCEPTION 'No se puede mover este lead'; END IF;
   RETURN jsonb_build_object('ok',true,'lead_id',v_lead,'stage',v_stage);
 ELSIF p_action='create_quote' THEN
   v_lead:=nullif(p_data->>'lead_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.sales_leads WHERE id=v_lead AND business_id=v_business AND stage NOT IN ('won','lost')) THEN RAISE EXCEPTION 'Lead no disponible para cotizar'; END IF;
   v_item:=nullif(p_data->>'product_id','')::uuid;
   IF v_item IS NULL THEN RAISE EXCEPTION 'Elige un producto'; END IF;
   SELECT name,price,currency INTO v_name,v_price,v_currency FROM public.link_sales_items WHERE id=v_item AND business_id=v_business AND status='active';
   IF v_name IS NULL THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
   v_qty:=coalesce(nullif(p_data->>'quantity','')::integer,1);
   IF v_qty NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
   v_amount:=round((v_qty*v_price)::numeric,2);
   PERFORM pg_advisory_xact_lock(hashtext(v_lead::text));
   SELECT coalesce(max(version),0)+1 INTO v_version FROM public.sales_quotes WHERE lead_id=v_lead;
   SELECT global_id INTO v_code FROM public.ecosystem_entities WHERE owner_domain='world' AND owner_table='link_sales_items' AND owner_record_id=v_item::text;
   INSERT INTO public.sales_quotes(lead_id,business_id,version,status,product_key,currency,base_amount,adjustments_amount,tax_amount,total_amount,snapshot,idempotency_key)
   VALUES(v_lead,v_business,v_version,'issued',v_code,v_currency,v_amount,0,0,v_amount,
    jsonb_build_object('product_id',v_item,'name',v_name,'unit_price',v_price,'quantity',v_qty,'tax_included_unspecified',true), gen_random_uuid()::text)
   RETURNING id INTO v_quote;
   UPDATE public.sales_leads SET stage='proposal' WHERE id=v_lead;
   RETURN jsonb_build_object('ok',true,'quote_id',v_quote,'version',v_version,'total',v_amount,'currency',v_currency);
 ELSIF p_action='accept_quote' THEN
   v_lead:=nullif(p_data->>'lead_id','')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.sales_leads WHERE id=v_lead AND business_id=v_business AND stage NOT IN ('won','lost')) THEN RAISE EXCEPTION 'Lead no disponible'; END IF;
   SELECT id INTO v_quote FROM public.sales_quotes WHERE lead_id=v_lead AND business_id=v_business AND status='issued' ORDER BY version DESC LIMIT 1;
   IF v_quote IS NULL THEN RAISE EXCEPTION 'No hay cotización emitida'; END IF;
   UPDATE public.sales_quotes SET status='accepted',accepted_at=now(),updated_at=now() WHERE id=v_quote;
   UPDATE public.sales_leads SET stage='won',closed_at=now(),outcome=coalesce(outcome,'{}'::jsonb)||jsonb_build_object('close_source','user_confirmed','accepted_quote_id',v_quote,'operation_ready',false) WHERE id=v_lead;
   RETURN jsonb_build_object('ok',true,'lead_id',v_lead,'quote_id',v_quote,'stage','won');
 ELSIF p_action='mark_ready' THEN
   v_lead:=nullif(p_data->>'lead_id','')::uuid;
   IF coalesce(p_data->>'human_confirmed','false')<>'true' THEN RAISE EXCEPTION 'Confirmación humana requerida'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.sales_leads l JOIN public.sales_quotes q ON q.lead_id=l.id AND q.status='accepted' WHERE l.id=v_lead AND l.business_id=v_business AND l.stage='won') THEN RAISE EXCEPTION 'Necesita venta cerrada y cotización aceptada'; END IF;
   UPDATE public.sales_leads SET outcome=coalesce(outcome,'{}'::jsonb)||jsonb_build_object('operation_ready',true,'confirmed_at',now(),'confirmed_by',v_uid,'operation_note',left(coalesce(p_data->>'note',''),500)) WHERE id=v_lead AND business_id=v_business;
   RETURN jsonb_build_object('ok',true,'lead_id',v_lead,'operation_ready',true);
 ELSE
   RAISE EXCEPTION 'Acción no permitida';
 END IF;
END
$function$

REVOKE ALL ON FUNCTION public.link_sales_portal(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_portal(text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.link_sales_portal(text,jsonb) IS 'LINK Ventas 2.0: API restringida por sesión y pertenencia al negocio.';
