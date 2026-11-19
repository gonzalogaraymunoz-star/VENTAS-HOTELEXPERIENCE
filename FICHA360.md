# Ficha 360 de cliente, LINK Ventas Hotel Experience

## Propósito
Completar progresivamente un expediente comercial y sus pasajeros, sin crear otro CRM ni confirmar una reserva por el hecho de guardar datos.

## Uso
1. Entra con tu cuenta de LINK Ventas y abre Clientes.
2. Abre Ficha 360 sobre un expediente existente. Usa Nueva ficha parcial sólo cuando hayas comprobado que no hay un expediente del mismo caso.
3. Incorpora información recibida y revisada. Puedes dejar campos pendientes. El remitente de un mensaje no se convierte automáticamente en contacto del pasajero.
4. Revisa servicio solicitado, modalidad, pasajeros y fuente. No unas solicitudes por parecido de nombres, teléfono, fecha o cantidad de pasajeros.
5. Completa hotel/origen y vendedor cuando se conozcan. No se eligen por defecto.
6. Guarda la ficha parcial. Conserva el enlace del mismo expediente para seguir completándolo.
7. Para cotizar y completar la reserva, utiliza el flujo comercial existente. La ficha parcial no confirma servicios.

## Recuperación desde LAMA y conversación
La recuperación es asistida. Se revisa el mensaje o conversación de origen, se identifican datos disponibles y contradicciones, se propone el expediente de destino y se incorporan los valores revisados. No existe una sincronización continua automática LAMA → Hotel Experience como parte de esta versión.

Antes del primer registro de datos personales se revisa el contenido que quedará guardado. Una consulta preliminar y un envío posterior de pasajeros permanecen separados hasta confirmar que corresponden al mismo caso. La ficha conserva una referencia breve de origen, no una copia completa de las conversaciones.

## Pendientes y significado de los campos
- Vacío significa pendiente, no dato negativo ni ausencia de necesidades.
- Un número de documento no identifica por sí solo su tipo ni nacionalidad.
- Una tarifa vacía no es una tarifa cero. El valor cero sólo se registra si se indicó explícitamente.
- La moneda queda pendiente si no fue informada.
- Ninguna persona se convierte en pasajero principal sólo por aparecer primero.
- Las declaraciones de alimentación, salud o accesibilidad se incorporan como información declarada, sin inferencias.

## Acceso
La ficha usa el acceso interno existente del CRM: administradores, responsables de gestión y consulta según su rol, y agentes con acceso al expediente propio o asignado. El enlace no concede acceso a personas sin autorización. Privada no significa exclusiva de una sola persona.

## Guardado parcial y límites
El guardado conserva el UUID del expediente y los UUID de pasajeros existentes. No elimina ni reconstruye servicios, no cambia su estado, no envía mensajes, no crea pagos, no ocupa cupos y no crea carpetas en Drive. La solicitud parcial se conserva en el mismo expediente, separada de los servicios comerciales ya creados.

La creación de un expediente conserva el evento interno de creación ya existente en el sistema. Ese evento contiene identificadores y estado comercial, no documentos, fechas de nacimiento ni notas médicas. Guardar la ficha no genera un evento de confirmación.

Las reservas ya confirmadas se consultan desde esta vista. Sus cambios posteriores continúan por el flujo existente, no por el guardado parcial.

## Cambios simultáneos y errores
Si otra persona cambió el expediente, recarga la ficha antes de volver a guardar para evitar sobrescribir información. Si un guardado no devuelve confirmación, revisa el expediente antes de repetirlo. Nunca crees otro expediente como solución automática a un error.

## Verificación de publicación
La comprobación técnica debe incluir compilación, vista escritorio y móvil, rechazo de acceso anónimo y roles sin permiso de escritura, persistencia y reapertura del mismo expediente. No se crean pasajeros o reservas ficticios en producción para probar el flujo. El primer guardado real necesita contenido revisado y autorizado.
