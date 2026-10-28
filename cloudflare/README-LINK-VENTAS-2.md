# LINK Ventas 2.0 · Adquisición + Ventas · LINK ID

**Desplegado:** https://link-ventas-2.gonzalogaraymunoz.workers.dev/  
**Estado:** piloto funcional (requiere validación E2E autenticada con usuario real, revisión comercial/fiscal y conectores externos antes de apertura general).  
**Aplicación original Vercel:** rama main de `VENTAS-HOTELEXPERIENCE` conservada sin reemplazo.

## Propósito
LINK Ventas es una plataforma comercial simple para profesionales y negocios de distintos rubros.

Un negocio puede dar de alta sus productos, recibir conversaciones de clientes, convertir mensajes revisados en leads con identidad, calificarlos, cotizar múltiples productos, registrar aceptación y controlar cobros manualmente.

## Flujo exacto
**Texto original → Bandeja de adquisición → Extracción transparente con fuentes resaltadas → Validación humana → Aduana LINK ID (deduplicación y vinculación) → Lead → Calificación → Ventas → Cotización con snapshot histórico → Aceptación → Cobro registrado/verificado manualmente → Confirmación para operación.**

**Nunca** se considera un mensaje como lead automáticamente. El paso de bandeja a lead requiere revisión explícita.

### Módulos
- **Mi negocio:** indicadores, solicitudes por atender, ventas aceptadas y cobros verificados agrupados por moneda.
- **Adquisición:** bandeja de solicitudes originales (canal, referencia, deduplicación), reglas de extracción ES/PT/EN, evidencias verificables, revisión humana, comparación por contacto con LINK ID y vinculación a lead abierto en el mismo negocio. Incluye importación **bajo demanda** de mensajes entrantes comerciales desde LINKRRSS, sin convertirlos automáticamente.
- **Ventas:** oportunidades, calificación, seguimiento comercial, cotizaciones de 1–20 productos, cierres confirmados.
- **Productos:** catálogo propio del negocio; altas y ediciones con `LNK-PRD-*` de `ecosystem_entities`. Índice único por nombre normalizado dentro de cada negocio.
- **Cobros:** abonos reportados, verificación **humana** de referencias y anulación auditable. No hay conciliación con banco/proveedor ni captura de fondos.
- **Accesos:** crear negocio o solicitar conexión a un `LNK-BIZ-*` existente, sin duplicarlo. Solicitudes externas requieren aprobación por propietario interno de LINK CONTROL CENTRAL.

## Backend y gobernanza
**Autoridad de datos:** Supabase LINK CONTROL CENTRAL `zgbnjlrxzvzpigmwidsp`. El Supabase original `lpirjwifzosdzgdncsbt` (Hotel Experience) se conserva.

### Objetos existentes (reutilizados)
`auth.users`, `link_world_businesses`, `ecosystem_entities`, `link_persons`, `link_person_leads`, `link_lead_identities`, `sales_leads`, `sales_quotes`, `link_interactions` y los disparadores de LINK ID existentes.

Los 74 registros de `product_catalog` del proyecto original **ya tienen** identidad de `ecosystem_entities`. Permanecen en el origen y **no se duplican** en el catálogo nuevo.

### Objetos propios del módulo comercial
- `link_sales_members`: permisos por usuario/negocio.
- `link_sales_items`: productos **nuevos** del portal, con una identidad global cada uno.
- `link_sales_inbox`: mensajes originales, evidencias, revisión y vínculo al lead.
- `link_sales_access_requests`: solicitud de membresía pendiente/aceptada/rechazada.
- `link_sales_receipts`: registro manual de cobros con estados reportado, verificado y anulado.

### RPC restringidas por auth.uid() + business_id
- `link_sales_portal(text,jsonb)` para negocio, catálogo, pipeline y aceptación; alta directa de lead deshabilitada para obligar aduana.
- `link_sales_acquisition(text,jsonb)` para `receive`, `identity_preview`, `convert`, `discard`, `list`.
- `link_sales_quote_multi(jsonb)` para cotización de varios productos.
- `link_sales_access(text,jsonb)` para solicitudes y aprobaciones.
- `link_sales_payments(text,jsonb)` para registro, verificación, consulta y anulación de pagos reportados.
- `link_sales_rrss(text,jsonb)` para descubrir candidatos comerciales LINKRRSS y copiar *solo el texto/evidencia de entrada a la bandeja* tras acción explícita de un miembro del negocio.

**Seguridad:** RLS en tablas nuevas, rol anon sin acceso directo de escritura, `service_role` jamás en el navegador. Las RPC son `SECURITY DEFINER` intencionalmente para escribir en las tablas originales con restricciones internas por sesión y pertenencia al negocio. La auditoría de Supabase emite WARN por esas funciones públicas ejecutables por `authenticated`: el aviso es conocido y requiere revisión continua; no es una certificación de seguridad completa. No se entregan datos de contactos ajenos a un negocio. Las acciones que cierran una venta o verifican un cobro requieren confirmación humana.

## Código
- `cloudflare/link-ventas-2.mjs`: HTML + frontend + Worker de Cloudflare desplegado.
- `cloudflare/link-ventas-2-migration.sql`: versión inicial aplicada anteriormente.
- `cloudflare/link-ventas-2-upgrade-v3.sql`: upgrade de aduana, producto, cotización, permisos y pagos.
- `cloudflare/link-ventas-2-upgrade-v4.sql`: definiciones vigentes de la aduana y el importador de LINKRRSS, conservando los metadatos de origen al convertir.

### Verificaciones efectuadas
- Worker subido a Cloudflare y publicado en `workers.dev`, despliegue con éxito.
- JavaScript del navegador pasa compilación sintáctica.
- Prueba SQL integral de **negocio → 2 productos → inbox idempotente → lead con persona LINK ID → cotización multi-producto → venta aceptada → listo para operar → lectura aislada de otro negocio**, satisfecha. Se realizó dentro de una transacción con ROLLBACK.
- Verificada existencia de tablas y RPC de pagos y solicitudes de acceso. Aún no se ha completado test E2E autenticado desde navegador ni reconciliación bancaria.


## Integración de fuentes v5 · alimentación continua
**LINKRRSS → Aduana LINK ID: ACTIVO.** El job `cron.job` denominado `link-ventas-rrss-intake-5m` revisa cada 5 minutos los mensajes entrantes que expresan intención comercial y cuya fecha sea posterior a la activación por negocio. Límite: 50 candidatos por ejecución; una solicitud pendiente por conversación. Identificación por mensaje original con `source_message_id` + `source_conversation_id`; `raw_message=NULL` para LINKRRSS y lectura directamente desde el origen al revisar. **No duplica textos en bandeja** ni retroimporta el historial. La conversión del lead exige confirmación humana y usa el mensaje solo como evidencia comercial histórica.

**Fuente habilitada prospectivamente** para los tres negocios que ya tenían cuentas LINKRRSS conectadas: CARACOL, LAMA Travelers y Raíces Atacama. No se conectaron nuevos perfiles de Instagram ni WhatsApp. Si dejan de llegar mensajes a LINKRRSS, este feed no puede recibirlos. El administrador puede vincular sus negocios existentes por LINK ID desde la sección **Accesos**, sin recrear fichas; cada propietario puede activar/detener el feed desde **Fuentes**.

**Websites → Aduana LINK ID: receptor seguro disponible, integración individual pendiente.** Endpoint para servidores `POST /api/intake`. Un propietario crea un origen desde la interfaz, recibe un `source_id` y una clave privada que **solo se muestra una vez**. Debe instalar su credencial en el backend de su website, jamás en HTML/Javascript público. La ruta del Worker rechaza solicitudes de navegador con encabezado `Origin`; Supabase valida hash SHA-256, estado activo, idempotencia `event_id` y límite 60 envíos por fuente/hora. Cada envío se registra como solicitud pendiente, no lead. Es necesaria la integración de cada website real; no se han cambiado websites de clientes.

**Seguridad y privacidad:** las API de ventas están limitadas por `auth.uid()` y `business_id` y la API pública de website solo admite credencial de alta entropía. El linter de Supabase advierte sobre funciones `SECURITY DEFINER` ejecutables por `authenticated` y una por `anon`; la exposición es deliberada para estos cinco módulos y necesita revisión continua. La validación con ROLLBACK cubrió web credential → inbox → revisión humana → LINK ID; y referencias RRSS sin duplicación de textos. Falta E2E HTTP real de workers.dev/website y prueba con múltiples usuarios finales antes de ofrecer servicio público.

**Archivo del upgrade:** `cloudflare/link-ventas-2-upgrade-v5.sql`.
**Guía de conexión:** `cloudflare/INTEGRACION-FUENTES.md`.


## Limitaciones explícitas
1. **LINKRRSS** usa ahora un cron activo cada 5 minutos para mensajes comerciales nuevos de negocios con feed activado. También conserva importación manual histórica. **No** hay webhooks propios directos desde Meta/WhatsApp: si el conector LINKRRSS no recibe mensajes, el cron no puede suplirlo. Las websites requieren instalar la credencial en sus servidores (aún no integradas individualmente).
2. Analizador **determinista** (regex, coincidencia de nombres de catálogo, citas resaltadas); no modelo IA general. No inventa campos ni atribuye confianzas estadísticas. Requiere revisión humana.
3. No hay cotizador fiscal, IVA automático, inventario, reservas ni ejecución operacional.
4. Los productos del catálogo original conservan su identidad y origen, pero su **edición y lectura extendida** no están integradas en este frontend; requiere autorización y adaptador.
5. Seguridad, flujos de permisos externos, control de concurrencia y pagos deben pasar un test de aceptación con usuarios de distintos negocios antes de invitar público abierto.
6. La importación social solo reconoce identidades por contacto validado; candidatos únicamente sociales sin correo o teléfono siguen sujetos a resolución humana en LINK ID antes de una fusión segura.
7. Visión de datos limitada por página (`250` leads, `150` solicitudes, `500` cobros), aún sin paginación avanzada.

**Ley del No Fake:** los datos reales solo se guardan en Supabase tras autenticación y acción humana. El modo DEMO es simulado y no guarda información en producción.
