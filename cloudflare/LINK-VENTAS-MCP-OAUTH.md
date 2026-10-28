# LINK Ventas + LINK ID · MCP nativo con OAuth 2.1

## Estado real (28 octubre 2026)
- **Implementado y desplegado** en Cloudflare: MCP nativo `POST /mcp/oauth`, documento RFC9728 en `/.well-known/oauth-protected-resource/mcp/oauth`, respuesta 401 con `WWW-Authenticate`, 17 herramientas ChatGPT, y pantalla `/oauth/consent`.
- **Implementado en LINK CONTROL CENTRAL**: `link_sales_mcp_oauth_grants`, `link_sales_mcp_consent`, `link_sales_mcp_execute`, `link_sales_mcp_access_token_hook`. Aislamiento de negocio, scopes `read`, `linkid:read`, `intake`, `sales`, limitador y revocación. La autorización utiliza Supabase Auth y PKCE manejados por Supabase, NO por el Worker.
- **Plugin privado creado**: [LINK Ventas en ChatGPT](https://chatgpt.com/plugins/plugins_6ae17d235fd88191a583101bee1e5c7a), versión 1.0.0, en estado creado; todavía requiere conexión OAuth en el cliente.
- **Pendiente de ajustes administradores en Supabase OAuth Server**: comprobar OAuth habilitado, activar DCR, configurar el Site URL y Authorization Path, activar hook de claims. No se cambiaron valores de Auth Site URL ni Hooks por no disponer de acción de configuración en el conector ni conocer el impacto en otros clientes.
- **Sin E2E autenticado real**: ningún cliente OAuth aparece registrado todavía, y no hay tokens reales de usuario emitidos para el servidor. No afirmar que @LINK Ventas ya puede usarse.

## Configuración manual necesaria (requiere propietario de Supabase)

Proyecto **LINK CONTROL CENTRAL**: `zgbnjlrxzvzpigmwidsp`

1. Abrir [Supabase OAuth Server](https://supabase.com/dashboard/project/zgbnjlrxzvzpigmwidsp/auth/oauth-server).
2. **Activar OAuth 2.1 Server** si aún no está habilitado. Verificar que el Authorization Endpoint sea `https://zgbnjlrxzvzpigmwidsp.supabase.co/auth/v1/oauth/authorize`.
3. **Activar Dynamic Client Registration (DCR)** para ChatGPT. Tras activarlo, el metadata endpoint `https://zgbnjlrxzvzpigmwidsp.supabase.co/.well-known/oauth-authorization-server/auth/v1` debe anunciar `registration_endpoint`. Al verificarlo antes de la activación **no lo anunciaba**.
4. **Configurar Authorization Path**: `/oauth/consent`. La página real ya está desplegada en `https://link-ventas-2.gonzalogaraymunoz.workers.dev/oauth/consent`.
5. **Revisar Auth Site URL** en Authentication → URL Configuration: Supabase construye el URL de consentimiento desde Site URL + Authorization Path. El Site URL debe ser `https://link-ventas-2.gonzalogaraymunoz.workers.dev` para que la autorización abra nuestra página. **ADVERTENCIA**: antes de modificar el Site URL, comprobar quién utiliza actualmente ese valor, porque el cambio afecta redirecciones de correo, login y otras aplicaciones. Conservar la lista de Redirect URLs existentes y añadir solo lo necesario.
6. Ir a Authentication → Hooks. Comprobar si existe ya un Custom Access Token hook. Si NO existe, activar SQL Hook `public.link_sales_mcp_access_token_hook`, que ya está creada y tiene permiso para `supabase_auth_admin`. Si ya existe un hook, **NO reemplazarlo**: fusionar la lógica del claim de recurso en ese hook de manera segura. El hook inyecta `mcp_resource=https://link-ventas-2.gonzalogaraymunoz.workers.dev/mcp/oauth` solo a tokens OAuth de clientes de ChatGPT registrados. La API bloquea tokens sin ese claim.
7. Comprobar en Authentication → JWT Signing Keys que los tokens OAuth están firmados por una llave asimétrica RS256/ES256 con JWKS disponible; no rotar llaves que estén activas sin plan de migración.

## Conectar desde ChatGPT

- Abrir el [complemento privado LINK Ventas](https://chatgpt.com/plugins/plugins_6ae17d235fd88191a583101bee1e5c7a).
- Instalar/conectar el plugin; cuando aparezca OAuth seleccionar **Conectar**. Si la instalación no crea la conexión, ChatGPT → Plugins → + → Add custom MCP server.
- Usar `https://link-ventas-2.gonzalogaraymunoz.workers.dev/mcp/oauth` como URL, autenticación OAuth, registro dinámico (DCR).
- En la pantalla LINK Ventas de consentimiento iniciar sesión con tu cuenta comercial, elegir UN negocio, habilitar los permisos deseados y aprobar. Los permisos de escribir Adquisición/Ventas están desmarcados por defecto.
- Abrir una conversación y seleccionar **@LINK Ventas**. Probar: «¿Qué negocio tengo conectado?», luego «Muéstrame las solicitudes pendientes». No registrar ventas reales como prueba sin autorización.
- Para desconectar: LINK Ventas → **API / LLM** → Autorizaciones OAuth → Revocar. También revocar desde el administrador de conexiones de ChatGPT.

## Seguridad

- La autenticación del usuario utiliza Supabase OAuth 2.1 (Authorization Code + PKCE). ChatGPT gestiona refresh tokens.
- El Worker verifica el JWT por medio de PostgREST/Supabase Auth. La base exige `auth.uid()`, `client_id`, el claim `mcp_resource`, una concesión explícita activa y pertenencia actual al negocio.
- El hash de cualquier clave API anterior permanece separado. OAuth no necesita entregar ni publicar claves `lvs_...`.
- ChatGPT puede leer una sola cuenta empresarial a la vez. Una persona con varios negocios elige la empresa al autorizar; el token no admite un `business_id` elegido por el modelo para saltarse el aislamiento.
- La API MCP tiene 17 herramientas (incluye perfil estable), y presenta metadatos de seguridad OAuth por herramienta. Los permisos sensibles requieren casillas explícitas al aprobar y confirmación humana en cada cierre.
- No hay copia del registro completo de LINK ID; reutilizamos las relaciones existentes de LINK CONTROL CENTRAL.
- **No existe garantía de conformidad completa de OAuth hasta probar el flujo de extremo a extremo**, incluido registro DCR, consent, intercambio PKCE, audiencia del JWT, refresco, revocación y errores de alcance.

## Pruebas ya realizadas
- Documento protegido RFC9728 HTTP público recuperado desde Cloudflare: correcto, con `authorization_servers` apuntando a Supabase.
- JavaScript del Worker/consent: compila.
- Transacción SQL con un cliente OAuth ChatGPT simulado, revertida al terminar: consentimiento, identidad de negocio, LINK ID, restricciones de lectura/escritura, revocación.
- Test adicional: token sin `mcp_resource` rechazado, token preparado por hook admitido, después revocado correctamente.
- Plugin privado creado en ChatGPT; sin instalación/consentimiento del usuario todavía.
