-- LINK Ventas v5 · continuous acquisition sources. LINK CONTROL CENTRAL only.
-- Applied to running central DB on 2026-10-27/28.
-- Run after v4. For new projects use the earlier v1-v4 migrations first.
-- LINKRRSS holds canonical message text. Inbox contains only source_message_id pointer.
-- Incoming commercial message feed defaults on only for preexisting connected RRSS business sources,
-- activated prospectively (no automatic historical backfill).
ALTER TABLE public.link_sales_inbox
 ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES public.link_rrss_messages(id) ON DELETE RESTRICT;
ALTER TABLE public.link_sales_inbox
 ADD COLUMN IF NOT EXISTS source_conversation_id uuid REFERENCES public.link_rrss_conversations(id) ON DELETE RESTRICT;
ALTER TABLE public.link_sales_inbox ALTER COLUMN raw_message DROP NOT NULL;
ALTER TABLE public.link_sales_inbox DROP CONSTRAINT IF EXISTS link_sales_inbox_source_required_chk;
ALTER TABLE public.link_sales_inbox ADD CONSTRAINT link_sales_inbox_source_required_chk CHECK (
 (raw_message IS NOT NULL AND length(raw_message) BETWEEN 3 AND 12000)
 OR (raw_message IS NULL AND source_message_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS link_sales_inbox_unique_source_message ON public.link_sales_inbox(business_id,source_message_id) WHERE source_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS link_sales_inbox_one_pending_conversation ON public.link_sales_inbox(business_id,source_conversation_id) WHERE source_conversation_id IS NOT NULL AND status='received';

CREATE TABLE IF NOT EXISTS public.link_sales_feed_settings(
 business_id uuid PRIMARY KEY REFERENCES public.link_world_businesses(id) ON DELETE CASCADE,
 rrss_enabled boolean NOT NULL DEFAULT false,only_after timestamptz NOT NULL DEFAULT now(),
 last_synced_at timestamptz,last_error text,updated_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.link_sales_feed_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_feed_settings_read ON public.link_sales_feed_settings;
CREATE POLICY link_sales_feed_settings_read ON public.link_sales_feed_settings FOR SELECT TO authenticated USING
 (EXISTS(SELECT 1 FROM public.link_sales_members m WHERE m.business_id=link_sales_feed_settings.business_id AND m.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.link_sales_feed_settings FROM anon,authenticated;
GRANT SELECT ON public.link_sales_feed_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.link_sales_feed_runs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source text NOT NULL CHECK (source IN ('linkrrss','website')),
 started_at timestamptz NOT NULL DEFAULT now(),scanned integer NOT NULL DEFAULT 0,
 imported integer NOT NULL DEFAULT 0,finished_at timestamptz,error text
);
ALTER TABLE public.link_sales_feed_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_sales_feed_runs FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.link_sales_web_sources(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 secret_hash text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 created_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 rotated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,name)
);
CREATE INDEX IF NOT EXISTS link_sales_web_sources_business_idx ON public.link_sales_web_sources(business_id,status);
ALTER TABLE public.link_sales_web_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_sales_web_sources_members ON public.link_sales_web_sources;
CREATE POLICY link_sales_web_sources_members ON public.link_sales_web_sources FOR SELECT TO authenticated USING
 (EXISTS(SELECT 1 FROM public.link_sales_members m WHERE m.business_id=link_sales_web_sources.business_id AND m.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.link_sales_web_sources FROM anon,authenticated;
GRANT SELECT (id,business_id,name,status,created_at,rotated_at) ON public.link_sales_web_sources TO authenticated;

-- Prospective active feeds (non-destructive, no backfill)
INSERT INTO public.link_sales_feed_settings(business_id,rrss_enabled,only_after)
SELECT DISTINCT p.business_id,true,now() FROM public.link_rrss_profiles p
JOIN public.link_rrss_sources s ON s.profile_id=p.id
JOIN public.link_rrss_accounts a ON a.source_id=s.id
WHERE a.platform IN ('whatsapp','instagram') AND a.status='connected'
ON CONFLICT (business_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.link_sales_feed_rrss_v1(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE v_imported integer:=0; v_scan integer:=0; v_run bigint;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Límite fuera de rango'; END IF;
 -- No historical bulk import: only incoming messages newer than each business's activation.
 -- One pending request per conversation; when reviewed, later inbound sales enquiries can enter.
 WITH eligible AS MATERIALIZED (
  SELECT DISTINCT ON (s.business_id,m.conversation_id)
    s.business_id,m.id AS message_id,m.conversation_id,a.platform,
    COALESCE(m.platform_created_at,m.created_at) AS occurred_at,c.participant_name
  FROM public.link_sales_feed_settings s
  JOIN public.link_rrss_profiles p ON p.business_id=s.business_id
  JOIN public.link_rrss_sources rs ON rs.profile_id=p.id
  JOIN public.link_rrss_accounts a ON a.source_id=rs.id
  JOIN public.link_rrss_conversations c ON c.account_id=a.id
  JOIN public.link_rrss_messages m ON m.conversation_id=c.id
  WHERE s.rrss_enabled=true AND a.status='connected'
   AND a.platform IN ('whatsapp','instagram')
   AND m.direction='incoming'
   AND m.message IS NOT NULL AND length(btrim(m.message)) BETWEEN 3 AND 12000
   AND COALESCE(m.platform_created_at,m.created_at)>s.only_after
   AND COALESCE(m.platform_created_at,m.created_at)<=now()+interval '2 minutes'
   AND lower(m.message) ~ '(cotiz|precio|presupuesto|or[cç]amento|quanto custa|quanto sai|custa|valor|how much|price|quote|budget|disponib|available|availability|quiero (comprar|reservar|cotizar)|gostaria de (reservar|comprar)|i (want|would like) to (book|buy)|reservar|reserva|booking|book a|book the|comprar|buy a)'
   AND NOT EXISTS (
    SELECT 1 FROM public.link_sales_inbox i
    WHERE i.business_id=s.business_id AND i.source_conversation_id=m.conversation_id
      AND i.status='received'
   )
  ORDER BY s.business_id,m.conversation_id,COALESCE(m.platform_created_at,m.created_at) DESC,m.id DESC
 ), picked AS (
   SELECT * FROM eligible ORDER BY occurred_at ASC LIMIT p_limit
 ), inserted AS (
   INSERT INTO public.link_sales_inbox(
    business_id,channel,external_ref,raw_message,fingerprint,source_message_id,source_conversation_id,evidence,review,created_by)
   SELECT
    x.business_id,x.platform,'linkrrss:'||x.message_id::text,NULL,
    md5(x.business_id::text||'|'||x.platform||'|'||x.message_id::text),
    x.message_id,x.conversation_id,
    jsonb_build_object('source','linkrrss','message_id',x.message_id,'conversation_id',x.conversation_id,'original_at',x.occurred_at,'feed','prospective-v1'),
    jsonb_build_object('suggested_name',left(coalesce(x.participant_name,''),160)),NULL
   FROM picked x
   ON CONFLICT DO NOTHING
   RETURNING id
 )
 SELECT (SELECT count(*) FROM picked),(SELECT count(*) FROM inserted) INTO v_scan,v_imported;

 UPDATE public.link_sales_feed_settings SET last_synced_at=now(),last_error=NULL
 WHERE rrss_enabled AND (last_synced_at IS NULL OR last_synced_at<now()-interval '1 minute');

 IF v_imported>0 THEN
  INSERT INTO public.link_sales_feed_runs(source,scanned,imported,finished_at)
  VALUES('linkrrss',v_scan,v_imported,now()) RETURNING id INTO v_run;
 END IF;
 RETURN jsonb_build_object('ok',true,'candidates',v_scan,'imported',v_imported,'feed_run',v_run);
END
$function$;

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
   SELECT jsonb_agg(jsonb_build_object('id',i.id,'channel',i.channel,'external_ref',i.external_ref,'raw_message',coalesce(i.raw_message,(SELECT m.message FROM public.link_rrss_messages m WHERE m.id=i.source_message_id)),'source_message_id',i.source_message_id,'status',i.status,
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
 v_evidence:=coalesce(v_inbox.evidence,'{}'::jsonb)||jsonb_build_object('extraction',v_evidence);
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
   VALUES(v_control,v_b,v_inbox.channel,
     CASE WHEN v_inbox.source_message_id IS NOT NULL THEN NULL ELSE v_inbox.external_ref END,
     v_name,v_email,v_phone,
     nullif(left(coalesce(array_to_string(v_products,', '),btrim(coalesce(p_data->>'interested_product',''))),600),''),
     coalesce(v_inbox.raw_message,(SELECT m.message FROM public.link_rrss_messages m WHERE m.id=v_inbox.source_message_id)),'new',
     jsonb_build_object('inbox_id',v_inbox.id,'source_message_id',v_inbox.source_message_id,'intake','LINK_ID_reviewed','product_ids',to_jsonb(v_product_ids),'review',v_review,'evidence',v_evidence))
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

CREATE OR REPLACE FUNCTION public.link_sales_feed_control(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_b uuid; v_role text; v_status record; v_enabled boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Acceso denegado al negocio'; END IF;
 IF p_action='status' THEN
  SELECT s.* INTO v_status FROM public.link_sales_feed_settings s WHERE s.business_id=v_b;
  RETURN jsonb_build_object('ok',true,
   'enabled',coalesce(v_status.rrss_enabled,false),'only_after',v_status.only_after,
   'last_synced_at',v_status.last_synced_at,'last_error',v_status.last_error,
   'sources',COALESCE((SELECT jsonb_agg(DISTINCT a.platform)
    FROM public.link_rrss_profiles p JOIN public.link_rrss_sources rs ON rs.profile_id=p.id
    JOIN public.link_rrss_accounts a ON a.source_id=rs.id
    WHERE p.business_id=v_b AND a.status='connected'),'[]'::jsonb));
 END IF;
 IF p_action='set' THEN
   IF v_role<>'owner' THEN RAISE EXCEPTION 'Solo el propietario habilita el flujo automático'; END IF;
   v_enabled:=(p_data->>'enabled')::boolean;
   IF v_enabled IS NULL THEN RAISE EXCEPTION 'Debes especificar enabled=true/false'; END IF;
   INSERT INTO public.link_sales_feed_settings(business_id,rrss_enabled,only_after,updated_by)
   VALUES(v_b,v_enabled,now(),v_uid)
   ON CONFLICT (business_id) DO UPDATE SET rrss_enabled=excluded.rrss_enabled,
     only_after=CASE WHEN excluded.rrss_enabled AND NOT public.link_sales_feed_settings.rrss_enabled
       THEN now() ELSE public.link_sales_feed_settings.only_after END,
     updated_by=v_uid,updated_at=now();
   RETURN jsonb_build_object('ok',true,'enabled',v_enabled);
 END IF;
 RAISE EXCEPTION 'Acción no permitida';
END $function$;

CREATE OR REPLACE FUNCTION public.link_sales_rrss(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_msg uuid;v_ch text;v_ref text;v_fp text;
 v_message text;v_conversation uuid;v_participant text;v_candidate record;v_record uuid;v_original timestamptz;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Sin acceso a este negocio'; END IF;
 IF p_action='candidates' THEN
   RETURN jsonb_build_object('ok',true,'candidates',coalesce((
   SELECT jsonb_agg(jsonb_build_object('message_id',t.message_id,'conversation_id',t.conversation_id,'channel',t.platform,
   'participant_name',t.participant_name,'raw_message',t.raw_message,'original_at',t.original_at,
   'identity_known',t.matched_person_id IS NOT NULL,'existing_lead',
    CASE WHEN EXISTS(SELECT 1 FROM public.sales_leads l WHERE l.id=t.matched_sales_lead_id AND l.business_id=v_b) THEN t.matched_sales_lead_id ELSE NULL END)
   ORDER BY t.original_at DESC)
   FROM (
    SELECT c.conversation_id,c.platform,c.participant_name,c.matched_person_id,c.matched_sales_lead_id,m.id message_id,
      m.message raw_message,COALESCE(m.platform_created_at,m.created_at) original_at
    FROM public.link_rrss_identity_candidates_v c
    JOIN LATERAL (SELECT id,message,platform_created_at,created_at FROM public.link_rrss_messages m
      WHERE m.conversation_id=c.conversation_id AND m.direction='incoming' AND length(btrim(coalesce(m.message,'')))>=3
      ORDER BY COALESCE(m.platform_created_at,m.created_at) DESC LIMIT 1) m ON TRUE
    WHERE c.business_id=v_b AND c.commercial_interest=true
      AND NOT EXISTS(SELECT 1 FROM public.link_sales_inbox i WHERE i.business_id=v_b AND i.external_ref='linkrrss:'||m.id::text)
    ORDER BY COALESCE(m.platform_created_at,m.created_at) DESC LIMIT 60
   ) t),'[]'::jsonb));
 END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'Permisos insuficientes para importar'; END IF;
 IF p_action<>'import' THEN RAISE EXCEPTION 'Acción inválida'; END IF;
 v_msg:=nullif(p_data->>'message_id','')::uuid;
 SELECT m.message, m.conversation_id,a.platform,c.participant_name,COALESCE(m.platform_created_at,m.created_at)
 INTO v_message,v_conversation,v_ch,v_participant,v_original
 FROM public.link_rrss_messages m
 JOIN public.link_rrss_conversations c ON c.id=m.conversation_id
 JOIN public.link_rrss_accounts a ON a.id=c.account_id
 JOIN public.link_rrss_sources s ON s.id=a.source_id
 JOIN public.link_rrss_profiles p ON p.id=s.profile_id
 WHERE m.id=v_msg AND m.direction='incoming' AND p.business_id=v_b;
 IF v_message IS NULL OR length(btrim(v_message)) NOT BETWEEN 3 AND 12000 THEN RAISE EXCEPTION 'Mensaje original no disponible o sin texto procesable'; END IF;
 SELECT matched_person_id,matched_sales_lead_id,commercial_interest
 INTO v_candidate FROM public.link_rrss_identity_candidates_v WHERE conversation_id=v_conversation AND business_id=v_b LIMIT 1;
 v_ref:='linkrrss:'||v_msg::text;
 v_ch:=CASE WHEN lower(coalesce(v_ch,'')) IN ('instagram','whatsapp','facebook') THEN lower(v_ch) ELSE 'other' END;
 v_fp:=md5(v_b::text||'|'||v_ch||'|'||v_ref);
 SELECT id INTO v_record FROM public.link_sales_inbox WHERE business_id=v_b AND external_ref=v_ref LIMIT 1;
 IF v_record IS NULL THEN
   INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,source_message_id,source_conversation_id,evidence,review,created_by)
   VALUES(v_b,v_ch,v_ref,NULL,v_fp,v_msg,v_conversation,
   jsonb_build_object('source','linkrrss','message_id',v_msg,'conversation_id',v_conversation,'original_at',v_original,
    'identity_candidate',v_candidate.matched_person_id IS NOT NULL,'commercial_hint',v_candidate.commercial_interest),
   jsonb_build_object('suggested_name',left(coalesce(v_participant,''),160)),v_uid)
   ON CONFLICT DO NOTHING RETURNING id INTO v_record;
   IF v_record IS NULL THEN SELECT id INTO v_record FROM public.link_sales_inbox WHERE business_id=v_b AND external_ref=v_ref LIMIT 1; END IF;
   IF v_record IS NULL THEN
     SELECT id INTO v_record FROM public.link_sales_inbox
     WHERE business_id=v_b AND source_conversation_id=v_conversation AND status='received'
     ORDER BY created_at DESC LIMIT 1;
   END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',v_record,'message_id',v_msg,'source','linkrrss');
END $function$;

CREATE OR REPLACE FUNCTION public.link_sales_website_ingest(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE v_source uuid;v_b uuid;v_st text;v_token text;v_secret text;v_msg text;
 v_event text;v_ref text;v_ch text:='website';v_fingerprint text;v_id uuid;v_body jsonb;
 v_count int;v_created boolean:=false;
BEGIN
 IF jsonb_typeof(p_data)<>'object' OR length(p_data::text)>18000 THEN RAISE EXCEPTION 'Solicitud no válida'; END IF;
 v_source:=nullif(p_data->>'source_id','')::uuid;
 v_token:=coalesce(p_data->>'secret','');
 SELECT business_id,status,secret_hash INTO v_b,v_st,v_secret FROM public.link_sales_web_sources WHERE id=v_source;
 IF v_b IS NULL OR v_st<>'active' OR length(v_token)<>64 OR encode(extensions.digest(v_token,'sha256'),'hex')<>v_secret THEN
  RAISE EXCEPTION 'Autorización de fuente no válida';
 END IF;
 v_event:=left(trim(coalesce(p_data->>'event_id','')),120);
 IF v_event='' OR v_event !~ '^[A-Za-z0-9_.:-]{6,120}$' THEN RAISE EXCEPTION 'event_id obligatorio para evitar duplicados'; END IF;
 v_msg:=trim(coalesce(p_data->>'message',''));
 IF length(v_msg) NOT BETWEEN 3 AND 12000 THEN RAISE EXCEPTION 'Solicitud vacía o demasiado larga'; END IF;
 -- Event reference remains unique even across days, and contains no raw PII.
 v_ref:='web:'||v_source::text||':'||v_event;
 v_fingerprint:=md5(v_b::text||'|'||v_ch||'|'||v_ref);
 SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=v_b AND channel=v_ch AND external_ref=v_ref;
 IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'status','already_received','request_id',v_id); END IF;
 SELECT count(*) INTO v_count FROM public.link_sales_inbox i
 WHERE i.business_id=v_b AND i.channel='website'
   AND i.evidence->>'web_source_id'=v_source::text AND i.created_at>now()-interval '1 hour';
 IF v_count>=60 THEN RAISE EXCEPTION 'Límite temporal de envíos para esta fuente'; END IF;
 v_body:=jsonb_build_object(
  'suggested_name',left(trim(coalesce(p_data->>'name','')),160),
  'suggested_email',left(trim(coalesce(p_data->>'email','')),200),
  'suggested_phone',left(trim(coalesce(p_data->>'phone','')),80),
  'suggested_product_id',left(trim(coalesce(p_data->>'product_id','')),50)
 );
 INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,evidence,review,created_by)
 VALUES(v_b,v_ch,v_ref,v_msg,v_fingerprint,
  jsonb_build_object('source','website','web_source_id',v_source,'event_id',v_event,
   'page_path',left(coalesce(p_data->>'page_path',''),500),
   'utm_source',left(coalesce(p_data->>'utm_source',''),100),
   'utm_medium',left(coalesce(p_data->>'utm_medium',''),100),
   'utm_campaign',left(coalesce(p_data->>'utm_campaign',''),100)),
  v_body,NULL)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN v_created:=true; END IF;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=v_b AND channel=v_ch AND external_ref=v_ref; END IF;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Recepción no confirmada'; END IF;
 RETURN jsonb_build_object('ok',true,'status',CASE WHEN v_created THEN 'received' ELSE 'already_received' END,'request_id',v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.link_sales_website_settings(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_id uuid;v_token text;v_status text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('ok',true,'sources',coalesce((
   SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'created_at',s.created_at) ORDER BY s.created_at DESC)
   FROM public.link_sales_web_sources s WHERE s.business_id=v_b),'[]'::jsonb));
 END IF;
 IF v_role<>'owner' THEN RAISE EXCEPTION 'Solo propietario puede administrar credenciales web'; END IF;
 IF p_action='create' THEN
  IF (SELECT count(*) FROM public.link_sales_web_sources WHERE business_id=v_b)>=10 THEN RAISE EXCEPTION 'Máximo 10 websites por negocio'; END IF;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.link_sales_web_sources(business_id,name,secret_hash,created_by)
  VALUES(v_b,left(trim(coalesce(p_data->>'name','')),100),encode(extensions.digest(v_token,'sha256'),'hex'),v_uid)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'source_id',v_id,'secret_once',v_token,'warning','Guarda esta clave en el servidor de tu website. Nunca en JavaScript público.');
 ELSIF p_action='rotate' THEN
  v_id:=nullif(p_data->>'source_id','')::uuid;v_token:=encode(extensions.gen_random_bytes(32),'hex');
  UPDATE public.link_sales_web_sources SET secret_hash=encode(extensions.digest(v_token,'sha256'),'hex'),rotated_at=now()
  WHERE id=v_id AND business_id=v_b RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Website no autorizado'; END IF;
  RETURN jsonb_build_object('ok',true,'source_id',v_id,'secret_once',v_token,'warning','La clave anterior deja de funcionar inmediatamente.');
 ELSIF p_action='set' THEN
  v_id:=nullif(p_data->>'source_id','')::uuid;v_status:=p_data->>'status';
  IF v_status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE public.link_sales_web_sources SET status=v_status WHERE id=v_id AND business_id=v_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'Website no autorizado'; END IF;
  RETURN jsonb_build_object('ok',true,'status',v_status,'source_id',v_id);
 END IF;
 RAISE EXCEPTION 'Acción no reconocida';
END $function$;

REVOKE ALL ON FUNCTION public.link_sales_acquisition(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_acquisition(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.link_sales_rrss(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_rrss(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.link_sales_website_ingest(jsonb) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.link_sales_website_ingest(jsonb) TO anon;
REVOKE ALL ON FUNCTION public.link_sales_website_settings(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_website_settings(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.link_sales_feed_control(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_feed_control(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.link_sales_feed_rrss_v1(integer) FROM PUBLIC,anon,authenticated;

-- A named pg_cron job: every 5 minutes, max 50 new messages per run, one pending per conversation.
SELECT cron.schedule('link-ventas-rrss-intake-5m','*/5 * * * *','SELECT private.link_sales_feed_rrss_v1(50);');
