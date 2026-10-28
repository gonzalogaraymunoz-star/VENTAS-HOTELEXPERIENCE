-- LINK Ventas 2.0 · Upgrade de Adquisición/Accesos/Cobros
-- APLICAR SOLO DESPUÉS DE cloudflare/link-ventas-2-migration.sql
-- Los cambios de esta versión ya se han aplicado al proyecto LINK CONTROL CENTRAL.
-- Los UUID/IDs originales y 74 productos legacy permanecen intactos.
CREATE UNIQUE INDEX IF NOT EXISTS link_sales_items_business_name_normalized_uniq ON public.link_sales_items(business_id,lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.link_sales_inbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE RESTRICT,
 channel text NOT NULL DEFAULT 'manual',
 external_ref text,
 raw_message text NOT NULL CHECK(length(raw_message) BETWEEN 3 AND 12000),
 fingerprint text NOT NULL,
 received_on date NOT NULL DEFAULT CURRENT_DATE,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','converted','discarded')),
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
 review jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(review)='object'),
 lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
 created_by uuid REFERENCES auth.users(id),
 reviewed_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 UNIQUE(business_id,channel,fingerprint,received_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS link_sales_inbox_external_uniq ON public.link_sales_inbox(business_id,channel,external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS link_sales_inbox_business_status_idx ON public.link_sales_inbox(business_id,status,created_at DESC);
ALTER TABLE public.link_sales_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_inbox_member_read ON public.link_sales_inbox;
CREATE POLICY link_sales_inbox_member_read ON public.link_sales_inbox FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.link_sales_members m WHERE m.business_id=link_sales_inbox.business_id AND m.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.link_sales_inbox FROM anon,authenticated;
GRANT SELECT ON public.link_sales_inbox TO authenticated;

CREATE TABLE IF NOT EXISTS public.link_sales_access_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_role text NOT NULL DEFAULT 'editor' CHECK(requested_role IN ('editor','viewer')),
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES auth.users(id),
 UNIQUE(business_id,user_id)
);
ALTER TABLE public.link_sales_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_access_requests_self_read ON public.link_sales_access_requests;
CREATE POLICY link_sales_access_requests_self_read ON public.link_sales_access_requests FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.link_sales_access_requests FROM anon,authenticated;
GRANT SELECT ON public.link_sales_access_requests TO authenticated;

CREATE TABLE IF NOT EXISTS public.link_sales_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE RESTRICT,
 lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE RESTRICT,
 quote_id uuid NOT NULL REFERENCES public.sales_quotes(id) ON DELETE RESTRICT,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 method text NOT NULL CHECK(method IN ('transfer','cash','card','link','other')),
 payment_reference text,
 note text,
 status text NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','verified','void')),
 created_by uuid REFERENCES auth.users(id),
 verified_by uuid REFERENCES auth.users(id),
 verified_at timestamptz,
 voided_by uuid REFERENCES auth.users(id),
 void_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_sales_receipts_business_idx ON public.link_sales_receipts(business_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS link_sales_receipts_payment_ref_idx ON public.link_sales_receipts(business_id,lower(btrim(payment_reference))) WHERE payment_reference IS NOT NULL AND status<>'void';
ALTER TABLE public.link_sales_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_receipts_member_read ON public.link_sales_receipts;
CREATE POLICY link_sales_receipts_member_read ON public.link_sales_receipts FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.link_sales_members m WHERE m.business_id=link_sales_receipts.business_id AND m.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.link_sales_receipts FROM anon,authenticated;
GRANT SELECT ON public.link_sales_receipts TO authenticated;

-- Funciones extraídas del estado SQL que está ejecutándose en LINK CONTROL CENTRAL.


-- RPC link_sales_access
CREATE OR REPLACE FUNCTION public.link_sales_access(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_code text;v_admin boolean;v_req uuid;v_decision text;v_target uuid;v_role text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 v_admin:=EXISTS(SELECT 1 FROM public.app_members m WHERE m.user_id=v_uid AND m.role='owner' AND m.status='active');
 IF p_action='my_requests' THEN
  RETURN jsonb_build_object('ok',true,'requests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'business_id',r.business_id,'name',b.name,'status',r.status,'role',r.requested_role,'created_at',r.created_at))
   FROM public.link_sales_access_requests r JOIN public.link_world_businesses b ON b.id=r.business_id WHERE r.user_id=v_uid),'[]'::jsonb),
   'is_admin',v_admin);
 END IF;
 IF p_action='pending' THEN
  IF NOT v_admin THEN RAISE EXCEPTION 'Solo el administrador LINK puede revisar solicitudes'; END IF;
  RETURN jsonb_build_object('ok',true,'requests',coalesce((
   SELECT jsonb_agg(jsonb_build_object('id',r.id,'business_id',r.business_id,'business_name',b.name,'user_id',r.user_id,'user_email',u.email,'note',r.note,'role',r.requested_role,'created_at',r.created_at) ORDER BY r.created_at)
   FROM public.link_sales_access_requests r JOIN public.link_world_businesses b ON b.id=r.business_id JOIN auth.users u ON u.id=r.user_id WHERE r.status='pending'),'[]'::jsonb));
 END IF;
 IF p_action='request' THEN
   v_code:=upper(btrim(coalesce(p_data->>'global_id','')));
   IF v_code NOT LIKE 'LNK-BIZ-%' THEN RAISE EXCEPTION 'Introduce un LINK ID de negocio válido'; END IF;
   SELECT id INTO v_b FROM public.link_world_businesses WHERE global_id=v_code;
   IF v_b IS NULL THEN RAISE EXCEPTION 'Negocio no encontrado. Verifica el código LINK ID'; END IF;
   IF EXISTS(SELECT 1 FROM public.link_sales_members WHERE user_id=v_uid AND business_id=v_b) THEN
    RETURN jsonb_build_object('ok',true,'status','already_member','business_id',v_b);
   END IF;
   IF v_admin THEN
    INSERT INTO public.link_sales_members(business_id,user_id,role) VALUES(v_b,v_uid,'owner')
    ON CONFLICT(business_id,user_id) DO NOTHING;
    RETURN jsonb_build_object('ok',true,'status','approved','business_id',v_b,'source','verified_admin');
   END IF;
   INSERT INTO public.link_sales_access_requests(business_id,user_id,requested_role,note,status)
   VALUES(v_b,v_uid,CASE WHEN p_data->>'role'='viewer' THEN 'viewer' ELSE 'editor' END,left(coalesce(p_data->>'note',''),500),'pending')
   ON CONFLICT(business_id,user_id) DO UPDATE SET status='pending',requested_role=excluded.requested_role,note=excluded.note,created_at=now(),resolved_at=NULL,resolved_by=NULL RETURNING id INTO v_req;
   RETURN jsonb_build_object('ok',true,'status','pending','request_id',v_req);
 END IF;
 IF p_action='resolve' THEN
   IF NOT v_admin THEN RAISE EXCEPTION 'Se requiere aprobación de LINK CONTROL CENTRAL'; END IF;
   v_req:=nullif(p_data->>'request_id','')::uuid; v_decision:=p_data->>'decision';
   IF v_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decisión inválida'; END IF;
   SELECT business_id,user_id,requested_role INTO v_b,v_target,v_role
   FROM public.link_sales_access_requests WHERE id=v_req AND status='pending' FOR UPDATE;
   IF v_b IS NULL THEN RAISE EXCEPTION 'Solicitud pendiente no encontrada'; END IF;
   IF v_decision='approved' THEN
    INSERT INTO public.link_sales_members(business_id,user_id,role) VALUES(v_b,v_target,v_role)
    ON CONFLICT(business_id,user_id) DO UPDATE SET role=excluded.role;
   END IF;
   UPDATE public.link_sales_access_requests SET status=v_decision,resolved_at=now(),resolved_by=v_uid WHERE id=v_req;
   RETURN jsonb_build_object('ok',true,'request_id',v_req,'status',v_decision);
 END IF;
 RAISE EXCEPTION 'Acción no permitida';
END $function$;
REVOKE ALL ON FUNCTION public.link_sales_access(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_access(text,jsonb) TO authenticated;


-- RPC link_sales_acquisition
CREATE OR REPLACE FUNCTION public.link_sales_acquisition(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_b uuid; v_role text; v_inbox public.link_sales_inbox%rowtype;
 v_channel text; v_raw text; v_ref text; v_fp text; v_id uuid; v_lead uuid; v_person uuid; v_existing uuid;
 v_email text; v_phone text; v_name text; v_suggested jsonb; v_review jsonb; v_evidence jsonb;
 v_control uuid; v_product_ids uuid[]; v_item uuid; v_product_name text; v_products text[]; v_contact_name text;
 v_match_count int:=0; v_identity_exists boolean:=false; v_conflict boolean:=false; v_matches jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Payload inválido'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 IF v_b IS NULL THEN RAISE EXCEPTION 'Selecciona un negocio'; END IF;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Negocio no autorizado'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('ok',true,'requests',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',i.id,'channel',i.channel,'external_ref',i.external_ref,'raw_message',i.raw_message,'status',i.status,
   'evidence',i.evidence,'review',i.review,'lead_id',i.lead_id,'created_at',i.created_at,'reviewed_at',i.reviewed_at) ORDER BY i.created_at DESC)
   FROM (SELECT * FROM public.link_sales_inbox WHERE business_id=v_b ORDER BY created_at DESC LIMIT 150) i),'[]'::jsonb));
 END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'Rol de solo lectura'; END IF;
 IF p_action='receive' THEN
  v_raw:=btrim(coalesce(p_data->>'raw_message',''));
  v_channel:=left(lower(btrim(coalesce(p_data->>'channel','manual'))),45);
  v_ref:=nullif(left(btrim(coalesce(p_data->>'external_ref','')),250),'');
  IF length(v_raw) NOT BETWEEN 3 AND 12000 THEN RAISE EXCEPTION 'Introduce la solicitud original (3-12000 caracteres)'; END IF;
  IF v_channel !~ '^[a-z0-9_-]{2,45}$' THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  v_fp:=md5(v_b::text||'|'||v_channel||'|'||coalesce(v_ref,lower(v_raw)));
  SELECT id INTO v_id FROM public.link_sales_inbox
   WHERE business_id=v_b AND channel=v_channel AND
   (external_ref=v_ref AND v_ref IS NOT NULL OR (fingerprint=v_fp AND received_on=CURRENT_DATE)) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,created_by)
    VALUES(v_b,v_channel,v_ref,v_raw,v_fp,v_uid)
    ON CONFLICT (business_id,channel,fingerprint,received_on) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=v_b AND channel=v_channel AND fingerprint=v_fp AND received_on=CURRENT_DATE LIMIT 1; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'reused',EXISTS(SELECT 1 FROM public.link_sales_inbox WHERE id=v_id AND created_by<>v_uid));
 END IF;
 IF p_action='identity_preview' THEN
  v_email:=nullif(lower(btrim(p_data->>'email')),'');
  v_phone:=private.link_phone_identity_key(p_data->>'phone');
  IF v_phone IS NOT NULL AND length(v_phone)<8 THEN v_phone:=NULL; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RETURN jsonb_build_object('ok',true,'identity_found',false,'matching_leads','[]'::jsonb,'requires_review',false); END IF;
  SELECT COUNT(DISTINCT p.id) INTO v_match_count FROM public.link_persons p
  JOIN public.link_person_leads pl ON pl.person_id=p.id AND pl.business_id=v_b
  WHERE p.status NOT IN ('merged','inactive') AND
    (v_email IS NOT NULL AND lower(btrim(p.email))=v_email OR v_phone IS NOT NULL AND private.link_phone_identity_key(p.phone)=v_phone);
  v_identity_exists:=(v_match_count>0);
  -- Only same-business leads may be disclosed. No cross-tenant person record is returned.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'name',l.full_name,'stage',l.stage,'product',l.interested_product,'created_at',l.created_at)),'[]'::jsonb)
  INTO v_matches FROM (
    SELECT id,full_name,stage,interested_product,created_at FROM public.sales_leads
    WHERE business_id=v_b AND stage NOT IN ('lost','won')
    AND (v_email IS NOT NULL AND lower(btrim(email))=v_email OR v_phone IS NOT NULL AND private.link_phone_identity_key(phone)=v_phone)
    ORDER BY created_at DESC LIMIT 8
  ) l;
  RETURN jsonb_build_object('ok',true,'identity_found',v_identity_exists,'possible_conflict',v_match_count>1,'matching_leads',v_matches,'requires_review',v_match_count>1);
 END IF;
 v_id:=nullif(p_data->>'inbox_id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'La solicitud debe ingresar por Aduana LINK ID'; END IF;
 SELECT * INTO v_inbox FROM public.link_sales_inbox WHERE id=v_id AND business_id=v_b FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada en este negocio'; END IF;
 IF p_action='discard' THEN
   IF v_inbox.status='converted' THEN RAISE EXCEPTION 'No es posible descartar una solicitud convertida'; END IF;
   UPDATE public.link_sales_inbox SET status='discarded',updated_at=now(),reviewed_by=v_uid,reviewed_at=now()
   WHERE id=v_id;
   RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'status','discarded');
 END IF;
 IF p_action<>'convert' THEN RAISE EXCEPTION 'Acción no permitida'; END IF;
 IF v_inbox.status='converted' THEN RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'lead_id',v_inbox.lead_id,'already_converted',true); END IF;
 IF v_inbox.status='discarded' THEN RAISE EXCEPTION 'La solicitud ya fue descartada'; END IF;
 IF (p_data->>'review_confirmed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Revisión humana obligatoria'; END IF;
 v_name:=nullif(left(btrim(coalesce(p_data->>'full_name','')),160),'');
 v_email:=nullif(lower(left(btrim(coalesce(p_data->>'email','')),200)),'');
 v_phone:=nullif(left(btrim(coalesce(p_data->>'phone','')),80),'');
 IF v_email IS NOT NULL AND v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' THEN RAISE EXCEPTION 'Correo inválido'; END IF;
 IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'Contacto insuficiente: nombre, correo o teléfono'; END IF;
 v_review:=coalesce(p_data->'review','{}'::jsonb);
 v_evidence:=coalesce(p_data->'evidence','{}'::jsonb);
 IF jsonb_typeof(v_review)<>'object' OR jsonb_typeof(v_evidence)<>'object' THEN RAISE EXCEPTION 'Evidencias inválidas'; END IF;
 IF length(v_review::text)>15000 OR length(v_evidence::text)>15000 THEN RAISE EXCEPTION 'Evidencias demasiado extensas'; END IF;
 v_product_ids:=ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(coalesce(p_data->'product_ids','[]'::jsonb)));
 IF cardinality(v_product_ids)>20 THEN RAISE EXCEPTION 'Máximo 20 productos por solicitud'; END IF;
 FOREACH v_item IN ARRAY v_product_ids LOOP
  SELECT name INTO v_product_name FROM public.link_sales_items WHERE id=v_item AND business_id=v_b AND status='active';
  IF v_product_name IS NULL THEN RAISE EXCEPTION 'Producto no autorizado o inactivo'; END IF;
  v_products:=array_append(v_products,v_product_name);
 END LOOP;
 v_lead:=nullif(p_data->>'existing_lead_id','')::uuid;
 IF v_lead IS NOT NULL THEN
   -- Attaching evidence is allowed only when the existing lead belongs to the business AND a contact detail matches.
   IF NOT EXISTS(SELECT 1 FROM public.sales_leads l WHERE l.id=v_lead AND l.business_id=v_b AND
    (v_email IS NOT NULL AND lower(btrim(l.email))=v_email OR
     v_phone IS NOT NULL AND private.link_phone_identity_key(l.phone)=private.link_phone_identity_key(v_phone))) THEN
    RAISE EXCEPTION 'El lead seleccionado no corresponde a la identidad revisada';
   END IF;
 ELSE
   SELECT id INTO v_control FROM public.controls WHERE slug='link-control-central' LIMIT 1;
   IF v_control IS NULL THEN RAISE EXCEPTION 'Control central no disponible'; END IF;
   INSERT INTO public.sales_leads(control_id,business_id,source,external_ref,full_name,email,phone,interested_product,message,stage,metadata)
   VALUES(v_control,v_b,v_inbox.channel,v_inbox.external_ref,v_name,v_email,v_phone,
     nullif(left(coalesce(array_to_string(v_products,', '),btrim(coalesce(p_data->>'interested_product',''))),600),''),
     v_inbox.raw_message,'new',
     jsonb_build_object('inbox_id',v_inbox.id,'intake','LINK_ID_reviewed','product_ids',to_jsonb(v_product_ids),'review',v_review,'evidence',v_evidence))
   RETURNING id INTO v_lead;
 END IF;
 UPDATE public.link_sales_inbox SET status='converted',lead_id=v_lead,review=jsonb_build_object('name',v_name,'email',v_email,'phone',v_phone,'product_ids',v_product_ids,'reviewed_by',v_uid,'details',v_review),
 evidence=v_evidence,reviewed_by=v_uid,reviewed_at=now(),updated_at=now() WHERE id=v_id;
 SELECT person_id INTO v_person FROM public.link_person_leads WHERE lead_id=v_lead;
 IF v_person IS NOT NULL AND (p_data->>'existing_lead_id') IS NOT NULL THEN
  INSERT INTO public.link_interactions(person_id,business_id,lead_id,action_type,channel,source,confidence,metadata)
  VALUES(v_person,v_b,v_lead,'inbound_message',v_inbox.channel,'link-ventas-inbox','observed',jsonb_build_object('inbox_id',v_inbox.id));
 END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'lead_id',v_lead,'person_matched',v_person IS NOT NULL,'identity_needs_review',v_person IS NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.link_sales_acquisition(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_acquisition(text,jsonb) TO authenticated;


-- RPC link_sales_payments
CREATE OR REPLACE FUNCTION public.link_sales_payments(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_quote uuid;v_lead uuid;v_currency text;
 v_total numeric;v_amount numeric;v_already numeric;v_receipt uuid;v_ref text;v_method text;v_status text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Negocio no autorizado'; END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('ok',true,'receipts',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',p.id,'lead_id',p.lead_id,'quote_id',p.quote_id,'amount',p.amount,'currency',p.currency,'method',p.method,'payment_reference',p.payment_reference,'note',p.note,'status',p.status,'created_at',p.created_at,'verified_at',p.verified_at,'void_reason',p.void_reason) ORDER BY p.created_at DESC)
    FROM (SELECT * FROM public.link_sales_receipts WHERE business_id=v_b ORDER BY created_at DESC LIMIT 500) p),'[]'::jsonb));
 END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'Rol de solo lectura'; END IF;
 IF p_action='record' THEN
  v_lead:=nullif(p_data->>'lead_id','')::uuid;
  v_quote:=nullif(p_data->>'quote_id','')::uuid;
  SELECT q.currency,q.total_amount INTO v_currency,v_total FROM public.sales_quotes q JOIN public.sales_leads l ON l.id=q.lead_id
   WHERE q.id=v_quote AND q.lead_id=v_lead AND q.business_id=v_b AND l.business_id=v_b AND q.status='accepted' FOR UPDATE OF q;
  IF v_total IS NULL THEN RAISE EXCEPTION 'Necesitas una cotización aceptada para registrar un cobro'; END IF;
  v_amount:=nullif(p_data->>'amount','')::numeric;
  IF v_amount IS NULL OR v_amount<=0 OR v_amount>v_total THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  v_method:=coalesce(nullif(p_data->>'method',''),'other');
  IF v_method NOT IN ('transfer','cash','card','link','other') THEN RAISE EXCEPTION 'Medio de pago inválido'; END IF;
  v_ref:=nullif(left(btrim(coalesce(p_data->>'payment_reference','')),200),'');
  SELECT coalesce(sum(amount),0) INTO v_already FROM public.link_sales_receipts WHERE quote_id=v_quote AND status<>'void';
  IF v_already+v_amount>v_total THEN RAISE EXCEPTION 'Los cobros registrados superarían el valor de la venta'; END IF;
  INSERT INTO public.link_sales_receipts(business_id,lead_id,quote_id,amount,currency,method,payment_reference,note,status,created_by)
  VALUES(v_b,v_lead,v_quote,v_amount,v_currency,v_method,v_ref,nullif(left(btrim(coalesce(p_data->>'note','')),500),''),'reported',v_uid)
  RETURNING id INTO v_receipt;
  RETURN jsonb_build_object('ok',true,'receipt_id',v_receipt,'status','reported','remaining',v_total-v_already-v_amount,'currency',v_currency);
 ELSIF p_action='verify' THEN
  v_receipt:=nullif(p_data->>'receipt_id','')::uuid;
  IF p_data->>'human_confirmed'<>'true' THEN RAISE EXCEPTION 'Confirmación humana obligatoria'; END IF;
  UPDATE public.link_sales_receipts SET status='verified',verified_by=v_uid,verified_at=now(),updated_at=now()
  WHERE id=v_receipt AND business_id=v_b AND status='reported' AND payment_reference IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cobro requiere comprobante o referencia antes de verificar'; END IF;
  RETURN jsonb_build_object('ok',true,'status','verified');
 ELSIF p_action='void' THEN
  IF v_role<>'owner' THEN RAISE EXCEPTION 'Solo propietario puede anular un registro de cobro'; END IF;
  v_receipt:=nullif(p_data->>'receipt_id','')::uuid;
  v_ref:=nullif(left(btrim(coalesce(p_data->>'reason','')),500),'');
  IF v_ref IS NULL THEN RAISE EXCEPTION 'Explica por qué anulas el registro'; END IF;
  UPDATE public.link_sales_receipts SET status='void',voided_by=v_uid,void_reason=v_ref,updated_at=now()
  WHERE id=v_receipt AND business_id=v_b AND status IN ('reported','verified');
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro no disponible para anular'; END IF;
  RETURN jsonb_build_object('ok',true,'status','void');
 END IF;
 RAISE EXCEPTION 'Acción no permitida';
END $function$;
REVOKE ALL ON FUNCTION public.link_sales_payments(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_payments(text,jsonb) TO authenticated;


-- RPC link_sales_portal
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
   RAISE EXCEPTION 'Las solicitudes deben pasar por Aduana LINK ID. Usa link_sales_acquisition.receive/convert.';

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
$function$;
REVOKE ALL ON FUNCTION public.link_sales_portal(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_portal(text,jsonb) TO authenticated;


-- RPC link_sales_quote_multi
CREATE OR REPLACE FUNCTION public.link_sales_quote_multi(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_business uuid; v_lead uuid; v_role text; v_lines jsonb; v_line jsonb;
 v_item_id uuid; v_price numeric; v_currency text; v_line_currency text; v_name text; v_gid text;
 v_qty integer; v_base numeric:=0; v_version integer; v_quote_id uuid; v_snapshot jsonb:='[]'::jsonb; v_status text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 IF jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
 v_business:=nullif(p_data->>'business_id','')::uuid; v_lead:=nullif(p_data->>'lead_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_business AND user_id=v_uid;
 IF v_role IS NULL OR v_role='viewer' THEN RAISE EXCEPTION 'Sin permisos comerciales'; END IF;
 SELECT stage INTO v_status FROM public.sales_leads WHERE id=v_lead AND business_id=v_business FOR UPDATE;
 IF v_status IS NULL OR v_status IN ('won','lost') THEN RAISE EXCEPTION 'Oportunidad no disponible'; END IF;
 v_lines:=p_data->'items';
 IF jsonb_typeof(v_lines)<>'array' OR jsonb_array_length(v_lines) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Agrega entre 1 y 20 productos'; END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
   v_item_id:=nullif(v_line->>'product_id','')::uuid; v_qty:=coalesce(nullif(v_line->>'quantity','')::integer,1);
   IF v_qty NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'Cantidad fuera de rango'; END IF;
   SELECT i.name,i.price,i.currency,e.global_id INTO v_name,v_price,v_line_currency,v_gid
   FROM public.link_sales_items i LEFT JOIN public.ecosystem_entities e ON e.owner_domain='world' AND e.owner_table='link_sales_items' AND e.owner_record_id=i.id::text
   WHERE i.id=v_item_id AND i.business_id=v_business AND i.status='active';
   IF v_name IS NULL OR v_gid IS NULL THEN RAISE EXCEPTION 'Producto no disponible o sin LINK ID'; END IF;
   IF v_currency IS NULL THEN v_currency:=v_line_currency; ELSIF v_currency<>v_line_currency THEN RAISE EXCEPTION 'Una cotización debe tener una misma moneda'; END IF;
   v_base:=v_base+round(v_price*v_qty,2);
   v_snapshot:=v_snapshot||jsonb_build_array(jsonb_build_object('product_id',v_item_id,'global_id',v_gid,'name',v_name,'quantity',v_qty,'unit_price',v_price,'line_total',round(v_price*v_qty,2),'currency',v_line_currency));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_lead::text,3));
 SELECT COALESCE(max(version),0)+1 INTO v_version FROM public.sales_quotes WHERE lead_id=v_lead;
 -- Issued quotes are superseded by the next issued version; accepted quotes never change.
 UPDATE public.sales_quotes SET status='withdrawn',updated_at=now() WHERE lead_id=v_lead AND status='issued';
 INSERT INTO public.sales_quotes(lead_id,business_id,version,status,currency,base_amount,adjustments_amount,tax_amount,total_amount,snapshot,idempotency_key)
 VALUES(v_lead,v_business,v_version,'issued',v_currency,v_base,0,0,v_base,
   jsonb_build_object('items',v_snapshot,'currency',v_currency,'priced_at',now(),'tax_scope','not_calculated','evidence','manual_product_selection'),gen_random_uuid()::text)
 RETURNING id INTO v_quote_id;
 UPDATE public.sales_leads SET stage='proposal' WHERE id=v_lead AND business_id=v_business;
 RETURN jsonb_build_object('ok',true,'quote_id',v_quote_id,'version',v_version,'amount',v_base,'currency',v_currency,'items_count',jsonb_array_length(v_snapshot));
END $function$;
REVOKE ALL ON FUNCTION public.link_sales_quote_multi(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_quote_multi(jsonb) TO authenticated;
