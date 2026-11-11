# API de EnRegla — referencia para el frontend

Versión de la API: la del código en `enregla/server` (sin prefijo de versión). Todas las rutas de la API cuelgan de `/api`. Las respuestas son JSON (`application/json; charset=utf-8`) salvo las descargas (PDF, CSV y exportación JSON) indicadas.

> El nombre comercial visible (emails, PDF) sale de la variable `APP_NAME` del servidor. El frontend no debe escribir la marca a mano en varios sitios: centralízala también en una constante.
>
> Las plantillas, rangos y textos son **orientativos**: el frontend no debe afirmar que la herramienta garantiza el cumplimiento legal ni la validez ante una inspección. Cada local debe adaptar la configuración a su propio plan de autocontrol.

Los esquemas zod usados por el servidor están en `enregla/server/src/schemas/index.ts` (solo dependen de `zod` v4) y se pueden importar desde el frontend para validar formularios con las mismas reglas: constantes `ALLERGENS`, `ALLERGEN_LABELS`, `RECORD_TYPES`, `RECORD_TYPE_LABELS`, `EQUIPMENT_TYPES`, `EQUIPMENT_TYPE_LABELS`, `BUSINESS_TYPES`, `BUSINESS_TYPE_LABELS`, `POLAR_COMPOUNDS_LIMIT`, y esquemas como `registerBody`, `createRecordBody`, `dishBody`, etc.

---

## 1. Convenciones

### 1.1 Formato de error uniforme

Toda respuesta de error (4xx/5xx) de `/api` tiene esta forma:

```ts
type ErrorResponse = {
  error: {
    code: ErrorCode;          // estable, para lógica del frontend
    message: string;          // en español, apto para mostrar al usuario
    details?: { path: string; message: string }[]; // solo en VALIDATION_ERROR (y algunos 400)
  };
};
```

`path` usa notación con puntos relativa al cuerpo o query (p. ej. `email`, `data.correctiveAction`, `items.0.area`).

**Mensajes en español, con el campo.** Todos los mensajes de validación (también los de zod) salen de un mapa de errores en español compartido con el frontend (`schemas/es.ts`, se activa al importar `schemas/index.ts`): «Escribe el nombre», «La temperatura debe estar entre −60 y 300 °C», «El nombre es demasiado largo (máximo 100 caracteres)»… Nunca aparecen textos de zod en inglés ni códigos internos. En `VALIDATION_ERROR`, `error.message` es el mensaje del primer campo (que ya lo nombra) y, si hay más, «Hay N datos más por revisar.»; antes era el genérico «Los datos enviados no son válidos».

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo/query no válidos (zod) o regla de negocio de validación (p. ej. falta acción correctora). Incluye `details`. |
| 400 | `BAD_REQUEST` | JSON malformado, rango de fechas excesivo, petición incoherente. |
| 400 | `INVALID_TOKEN` | Token de email/invitación inválido, caducado o ya usado. Mensaje: «Este enlace no es válido: puede que haya caducado o que ya se haya usado.» (muéstralo tal cual, sin añadir más texto). |
| 401 | `UNAUTHENTICATED` | Falta sesión (o token de kiosko) o ha caducado. |
| 401 | `INVALID_CREDENTIALS` | Email/contraseña incorrectos, o contraseña de reautenticación incorrecta. |
| 401 | `PIN_REQUIRED` | Kiosko: el miembro del personal tiene PIN y no se ha enviado. |
| 401 | `INVALID_PIN` | Kiosko: PIN incorrecto. |
| 402 | `READ_ONLY` | La suscripción del local no está activa: solo lectura. |
| 403 | `EMAIL_NOT_VERIFIED` | Login con email sin verificar (se reenvía el enlace automáticamente). |
| 403 | `FORBIDDEN` | Autenticado y miembro, pero sin el rol necesario (p. ej. manager en acción de owner). |
| 403 | `CSRF_FAILED` | Falta `X-Requested-With` u `Origin` no permitido. |
| 404 | `NOT_FOUND` | Recurso inexistente **o de otra organización** (nunca se revela si existe). También rutas desconocidas. |
| 409 | `CONFLICT` | Estado incompatible (último propietario, enmienda duplicada, ya miembro, ya suscrito, `Idempotency-Key` reutilizada con otro cuerpo, local ya pendiente de eliminación…). |
| 415 | `BAD_REQUEST` | `Content-Type` no admitido (usa `application/json`). No envíes `Content-Type: application/json` con cuerpo vacío (→ 400). |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo > 256 KiB (1 MiB en el webhook). |
| 400 | `REPORT_TOO_LARGE` | Informe PDF con más de 5000 registros (acota fechas/tipos o usa el CSV) o CSV con más de 500 000 (acota y descárgalo en partes). |
| 429 | `RATE_LIMITED` | Límite de peticiones (o servidor ocupado generando PDF). Cabecera `Retry-After` (segundos). Muestra `error.message`, que explica el motivo. |
| 429 | `PIN_LOCKED` | Kiosko: PIN bloqueado tras 5 fallos (15 min). Cabecera `Retry-After`. |
| 502 | `BILLING_ERROR` | Fallo al hablar con Stripe (también al cancelar la suscripción cuando se elimina un local: el local NO se elimina). En el webhook, 503 `BILLING_ERROR` = «reintentar» (solo lo ve Stripe). |
| 503 | `BILLING_NOT_CONFIGURED` | Stripe no configurado en el servidor. |
| 500 | `INTERNAL_ERROR` | Error inesperado (sin detalles internos). |

### 1.2 Tipos comunes

- Ids: UUID (string). Un id con formato inválido en la ruta responde **404**, no 400.
- Fechas-hora: ISO 8601 en UTC (`"2026-11-09T17:03:00.000Z"`). Muéstralas en la zona horaria del local (`organization.timezone`).
- Fechas sin hora: `"AAAA-MM-DD"` (fecha local del local). Solo se admiten años **2000–2100** (fuera → 400 `VALIDATION_ERROR`).
- Zonas horarias: solo nombres IANA de `Intl.supportedValuesOf('timeZone')` más `"UTC"` (p. ej. `"Europe/Madrid"`). Desplazamientos como `"+01:00"` → 400.
- Ningún texto (cuerpo, query o ruta) puede contener el carácter NUL (`\u0000`) → 400 `VALIDATION_ERROR`. Las entradas raras (fechas imposibles, números gigantes, cursores corruptos) responden 400/404, nunca 500.
- Todas las horas de los registros son **del servidor**: el cliente no puede fijarlas.

### 1.3 Paginación

Los listados devuelven:

```ts
type Page<T> = { items: T[]; nextCursor: string | null };
```

Query: `limit` (1–200, por defecto 50) y `cursor` (el `nextCursor` de la página anterior; es el id del último elemento). Valores fuera de rango → 400. Orden: configuración por fecha de creación ascendente; registros por fecha descendente (más recientes primero); auditoría por id descendente.

Excepciones (sin cursor, tope fijo): `GET /members` y `GET /invitations` devuelven como máximo 200 elementos y `nextCursor: null`; `GET /api/orgs` devuelve `{ items }` (máx. 200).

### 1.4 Autenticación por cookie y CSRF (SPA)

- La sesión es una cookie `httpOnly` gestionada por el servidor: **el frontend nunca la lee ni guarda tokens**. Nombre: `__Host-enregla_session` (con `Secure`, producción) o `enregla_session` (desarrollo sobre http). `SameSite=Lax`, `Path=/`.
- Caducidad: absoluta 30 días, por inactividad 7 días (configurable). Una respuesta 401 `UNAUTHENTICATED` significa "vuelve a la pantalla de login".
- **Toda petición mutante** (`POST`, `PATCH`, `PUT`, `DELETE`) a `/api/*` (excepto `/api/kiosk/*` y `/api/billing/webhook`) debe:
  1. llevar la cabecera `X-Requested-With: XMLHttpRequest`, y
  2. venir de un origen permitido: el navegador envía `Origin` automáticamente; debe coincidir con `APP_URL` (o un `DEV_ORIGINS`). Si no hay `Origin`, se exige `Sec-Fetch-Site: same-origin`.
- Las peticiones `GET` no necesitan esas cabeceras (pero no hacen daño).
- Usa `credentials: 'same-origin'` (o `'include'` si en desarrollo la SPA está en otro origen listado en `DEV_ORIGINS`).

Cliente mínimo recomendado:

```ts
async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error.message), data.error, { status: res.status });
  return data as T;
}
```

En desarrollo, lo más sencillo es que Vite haga proxy de `/api` a `http://localhost:3000` (mismo origen). Para descargar PDF/CSV/exportación basta con un enlace `<a href="/api/orgs/{id}/reports/pdf?...">` (GET con cookie).

### 1.5 Enlaces de los emails (rutas del frontend)

Los emails apuntan a rutas de la SPA con el token **en el fragmento** (`#token=...`), que nunca llega al servidor ni a los logs. El frontend debe leer `location.hash`, extraer `token` y enviarlo por POST:

| Ruta de la SPA | Acción |
|---|---|
| `/verificar-email#token=…` | `POST /api/auth/verify-email` |
| `/restablecer-contrasena#token=…` | formulario de nueva contraseña → `POST /api/auth/password-reset/confirm` |
| `/confirmar-email#token=…` | `POST /api/auth/email-change/confirm` |
| `/invitacion#token=…` | `POST /api/invitations/preview`; tras login/registro, `POST /api/invitations/accept` |
| `/recuperar-contrasena` | formulario → `POST /api/auth/password-reset/request` |
| `/locales/{orgId}/facturacion?checkout=ok\|cancelado` | retorno de Stripe Checkout / portal |
| `/` | enlace del recordatorio diario |

Tras leer el token, haz `history.replaceState` para quitar el fragmento de la barra de direcciones.

### 1.6 Límites de peticiones (por defecto)

Todas las respuestas 429 llevan `Retry-After` (segundos) y un `error.message` en español apto para mostrar.

| Clave | Límite |
|---|---|
| Login por IP | 30 / 15 min |
| Login por cuenta **desde una misma IP** | 10 / 15 min (se reinicia tras un login correcto). Un tercero desde su IP no bloquea al titular en la suya |
| Login por cuenta (todas las IP) | 100 / hora (techo contra fuerza bruta distribuida) |
| Registro por IP | 10 / hora |
| Reenvío de verificación por IP | 10 / hora (clave propia, separada de la de recuperación) |
| Emails de verificación por cuenta (registro, reenvío, login sin verificar) | 3 / hora; el exceso se ignora en silencio (sigue respondiendo 202) |
| Recuperación de contraseña por IP | 10 / hora |
| Recuperación por cuenta | 3 / hora (el exceso se ignora en silencio: sigue respondiendo 202) |
| Verificación de tokens (verify, reset confirm, email-change, invitaciones) por IP | 30 / 15 min |
| Reautenticación (cambiar contraseña/email, borrar cuenta/local) por usuario | 10 / 15 min |
| Carta pública por IP | 120 / min |
| Kiosko por dispositivo | 600 / min; intentos de PIN 30 / 15 min; **PIN erróneos 20 / 15 min** (todas las personas) |
| Alta de registros y enmiendas (web) por usuario y local | 120 / min |
| Alta de registros (kiosko) por dispositivo | 120 / min |
| Informes PDF | 10 / 10 min por local **y** por usuario |
| Informes CSV | 20 / 10 min por local y por usuario |
| Exportación RGPD | 5 / hora por local y por usuario |
| PDF generándose a la vez en el servidor | 2 (`PDF_MAX_CONCURRENCY`). Si están ocupados, la petición **espera en una cola por orden de llegada** hasta 20 s (`PDF_QUEUE_MAX_WAIT_SECONDS`); si no hay hueco a tiempo (o hay 50 esperando) → 429 con `Retry-After` |
| PDF a la vez por local y por usuario (NUEVO, B-2) | 1 en generación o en cola: un segundo PDF del mismo local (aunque lo pida otro usuario) o del mismo usuario (aunque sea de otro local) → 429 con `Retry-After` y mensaje propio («Ya se está generando un informe PDF de este local…» / «Ya estás generando otro informe PDF…») |
| Tiempo de generación de PDF por local (NUEVO, B-2) | 180 s por hora (`PDF_BUDGET_SECONDS_PER_HOUR`); agotado → 429 con `Retry-After` hasta que se renueva la ventana («…ha agotado el tiempo de generación de informes PDF de esta hora…») |
| Invitaciones al mismo email por local | 3 / día |
| Invitaciones por local | 20 / día |
| Invitaciones por usuario (todos sus locales) | 30 / día |

### 1.7 Idempotencia al crear registros (`Idempotency-Key`)

`POST /api/orgs/{orgId}/records`, `POST /api/orgs/{orgId}/records/{recordId}/amendments` y `POST /api/kiosk/records` aceptan la cabecera opcional **`Idempotency-Key: <UUID>`**. Sirve para que un reintento (red móvil que se corta, doble toque en «Guardar», cola offline de la tablet) no duplique el registro.

Cómo usarla en el cliente:

1. Genera **una clave nueva por registro que el usuario quiere crear** (`crypto.randomUUID()`) en el momento en que pulsa «Guardar», y guárdala junto a los datos del formulario (en memoria o en la cola offline).
2. Envía esa misma clave en **todos los reintentos** de ese mismo registro, con el **mismo cuerpo**.
3. Respuestas:
   - `201 { record }` → creado ahora.
   - `200 { record }` + cabecera `Idempotent-Replayed: true` → ya existía (un intento anterior llegó al servidor): trátalo como éxito; es el **mismo** registro (mismo `id`). También ocurre con peticiones simultáneas con la misma clave: solo una crea el registro.
   - `409 CONFLICT` → esa clave ya se usó con **otro** cuerpo (bug del cliente: no reutilices claves entre registros distintos). Genera una nueva.
   - `400 VALIDATION_ERROR` (`path: "Idempotency-Key"`) → la clave no es un UUID.
   - Un error (400/402/404/429…) **no consume** la clave: corrige y reintenta con la misma o con otra.
4. Tras un éxito, descarta la clave. Nueva acción del usuario = nueva clave.

Las claves son únicas **por local** y se conservan **7 días**; en el kiosko el PIN no forma parte de la comparación del cuerpo. Sin cabecera, el comportamiento es el de siempre (cada petición crea un registro).

---

## 2. Salud

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/healthz` | `200 { "status": "ok" }` (proceso vivo) |
| GET | `/readyz` | `200 { "status": "ok" }` o `503 { "status": "unavailable", "reason"?: "shutting_down" }` (503 si la BD no responde en 3 s o si el proceso se está apagando) |

---

## 3. Autenticación — `/api/auth` (sin sesión previa)

Respuestas que no revelan si un email existe: registro, reenvío y recuperación responden siempre igual.

```ts
type User = { id: string; email: string; name: string; emailVerified: boolean; createdAt?: string };
```

### POST `/api/auth/register`
Cuerpo: `{ email: string; password: string; name: string }`
- `email`: se normaliza (trim + minúsculas), máx. 254.
- `password`: 10–128 caracteres; no puede ser un único carácter repetido ni **coincidir exactamente** (sin distinguir mayúsculas) con una contraseña de la lista de las más usadas. **Datos personales (CAMBIO, I-5):** comparando sin mayúsculas, tildes, espacios ni signos, se rechaza si es el email, si **contiene** la parte del email antes de la @ o el nombre (completo o cualquiera de sus palabras) cuando tienen **5 o más** caracteres («juanperez1» con juanperez@…), o si es uno de ellos con **como mucho 7** caracteres añadidos al principio o al final («ana2026xyz» con ana@…). Contener una palabra común está permitido («Contrasena-Larga-77x» es válida). La política está en `schemas/password-policy.ts` (`checkPasswordPolicy`, `passwordRules`) y el frontend usa la misma. El mensaje de error explica el motivo.
- `name`: 1–100.

`202 { "message": "Si los datos son correctos, recibirás un email en unos minutos." }`
Envía el email de verificación (24 h). Si el email ya tenía cuenta verificada, se envía un aviso al dueño (sin token) y la respuesta es idéntica. Si ya existía una cuenta **sin verificar** con ese email, **no** se cambian su contraseña ni su nombre: solo se reenvía el enlace (quien no recuerde la contraseña usa "recuperar contraseña"). **No inicia sesión.**
La cuenta y el email se crean justo después de responder (la respuesta no espera): el email puede tardar unos instantes más.
Errores: 400 `VALIDATION_ERROR`, 429.

### POST `/api/auth/verify-email`
Cuerpo: `{ token: string }` → `200 { "message": "Email confirmado. Ya puedes iniciar sesión." }`
Errores: 400 `INVALID_TOKEN`, 429.

### POST `/api/auth/resend-verification`
Cuerpo: `{ email: string }` → `202 { "message": … }` (siempre).

### POST `/api/auth/login`
Cuerpo: `{ email: string; password: string }` → `200 { "user": User }` + cookie de sesión (rota la sesión: cualquier sesión previa enviada en la petición se invalida).
Errores: 401 `INVALID_CREDENTIALS` (mismo mensaje para email inexistente y contraseña mala), 403 `EMAIL_NOT_VERIFIED` (se reenvía el enlace), 429 `RATE_LIMITED`.

### POST `/api/auth/logout`
Sin cuerpo. `204`. Borra la sesión actual (si la hay) y la cookie.

### POST `/api/auth/logout-all`
Requiere sesión. `204`. Cierra **todas** las sesiones del usuario (incluida la actual). 401 sin sesión.

### POST `/api/auth/password-reset/request`
Cuerpo: `{ email: string }` → `202 { "message": … }` (siempre, y sin esperar a buscar la cuenta). Envía enlace de 1 hora, un solo uso.

### POST `/api/auth/password-reset/confirm`
Cuerpo: `{ token: string; password: string }` → `200 { "message": "Contraseña actualizada. Ya puedes iniciar sesión." }`
Cierra todas las sesiones del usuario, **anula todos sus enlaces pendientes** (cambio de email, otros resets, verificación) y marca el email como verificado. No inicia sesión.
Errores: 400 `INVALID_TOKEN`, 400 `VALIDATION_ERROR` (política de contraseña; el token **no** se consume en ese caso), 429.

### POST `/api/auth/email-change/confirm`
Cuerpo: `{ token: string }` → `200 { "message": "Email actualizado." }`. Se avisa al email anterior. **Además (I-7):** se anulan todos los enlaces pendientes del usuario (restablecer contraseña, otros cambios de email, verificación) y se **cierran las demás sesiones**; solo se conserva la sesión desde la que se confirma, si es la del propio titular (si se confirma sin sesión o con otra cuenta, se cierran todas: el frontend debe llevar al login).
Errores: 400 `INVALID_TOKEN`, 409 `CONFLICT` (el email ya lo usa otra cuenta).

---

## 4. Cuenta — `/api/account` (requiere sesión)

### GET `/api/account`
```ts
200 {
  user: User;
  organizations: { id: string; name: string; businessType: BusinessType; role: 'owner' | 'manager'; subscription: Subscription; deletionScheduledAt: string | null }[];
}
```

### PATCH `/api/account`
Cuerpo: `{ name: string }` → `200 { user: User }`.

### POST `/api/account/password`
Cuerpo: `{ currentPassword: string; newPassword: string }` → `204`. Cierra las **demás** sesiones (la actual sigue) y **anula todos los enlaces pendientes** (cambio de email, reset). Email de aviso.
Errores: 401 `INVALID_CREDENTIALS`, 400 `VALIDATION_ERROR`, 429.

### POST `/api/account/email`
Cuerpo: `{ password: string; newEmail: string }` → `202 { "message": "Te hemos enviado un enlace de confirmación al nuevo email." }`. El cambio se aplica al confirmar (`/api/auth/email-change/confirm`). Si el email ya está en uso no se envía nada al nuevo, pero la respuesta es la misma. Siempre se envía un **aviso al email actual** ("se ha solicitado cambiar el email…; si no has sido tú, cambia la contraseña"), y otro cuando el cambio se confirma.
Errores: 401 `INVALID_CREDENTIALS`, 400 (igual al actual), 429.

### DELETE `/api/account`
Cuerpo: `{ password: string }` → `204` (borra la cookie). Los registros firmados conservan el nombre del firmante. Se **revocan los dispositivos de cocina que creó** y sus eventos de auditoría se seudonimizan (sin email ni IP). Nunca elimina locales.
Errores: 401 `INVALID_CREDENTIALS`, 409 `CONFLICT` si es el único propietario de algún local (debe eliminar el local o nombrar otro propietario antes). Los locales ya **pendientes de eliminación** no bloquean el borrado de la cuenta.

---

## 5. Organizaciones (locales)

```ts
type BusinessType = 'bar' | 'restaurante' | 'cafeteria' | 'obrador' | 'catering' | 'tienda';
type Subscription = {
  status: 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused';
  readOnly: boolean;          // true en trial_expired, unpaid, canceled, incomplete_expired, paused, past_due durante más de 21 días, o si el local está pendiente de eliminación
  paymentFailed: boolean;     // NUEVO: true en 'past_due' (cobro fallido, Stripe reintentando): se puede escribir, pero muestra un aviso
  pastDueSince: string | null; // NUEVO (I-3): desde cuándo está en 'past_due'. Pasados 21 días (PAST_DUE_READ_ONLY_DAYS) → readOnly: true aunque status siga siendo 'past_due'
  trialEndsAt: string;        // ISO
  plan: 'monthly' | 'annual' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasBillingAccount: boolean; // existe cliente de Stripe (portal disponible)
};
type Organization = {
  id: string;
  name: string;
  businessType: BusinessType;
  timezone: string;           // IANA, p. ej. "Europe/Madrid"
  reminderEnabled: boolean;
  reminderHour: number;       // 0–23, hora local
  role: 'owner' | 'manager';  // rol del usuario actual
  publicMenu: { enabled: boolean; slug: string };
  subscription: Subscription;
  deletionScheduledAt: string | null; // NUEVO: si no es null, el local está pendiente de eliminación definitiva en esa fecha
  createdAt: string;
};
```

**Roles.** `owner`: todo. `manager`: todo lo operativo (registros, personal, equipos, limpieza, proveedores, platos/carta, dispositivos, informes, tareas) pero **no**: editar ajustes del local, gestionar miembros/invitaciones, facturación, exportación RGPD, auditoría ni borrar el local (→ 403 `FORBIDDEN`).

**Solo lectura.** Si `subscription.readOnly` es `true` (por la suscripción **o** porque el local está pendiente de eliminación: mira primero `deletionScheduledAt`), toda creación/edición responde 402 `READ_ONLY`. Siguen permitidos: todas las lecturas, informes PDF/CSV, exportación, facturación (checkout/portal), revocar dispositivos, quitar miembros/salir, preferencias personales, **desactivar la carta pública** y eliminar el local. Mientras está en solo lectura, la carta pública **no se sirve** (404) aunque esté activada; vuelve a servirse al reactivar la suscripción.

**Aislamiento.** Todas las rutas `/api/orgs/{orgId}/…` exigen sesión y pertenencia. Si el usuario no es miembro, o cualquier id de la ruta o del cuerpo pertenece a otro local → **404**.

### GET `/api/orgs`
`200 { items: Organization[] }`

### POST `/api/orgs`
Cuerpo: `{ name: string (1–120); businessType: BusinessType; timezone?: string (IANA, por defecto "Europe/Madrid") }`
`201 { organization: Organization }` (rol `owner`). **La prueba es una por cuenta de usuario:** el primer local que crea el usuario inicia 14 días sin tarjeta; los siguientes heredan la misma `trialEndsAt`, y si ya caducó el local nace en solo lectura (`subscription.status: 'trial_expired'`, `readOnly: true`) hasta contratar. En todos los casos precarga una plantilla orientativa de equipos y planes de limpieza según el tipo (todo editable):

- refrigeración (cámaras, vitrinas): `maxTemp: 4`, `minTemp: null`
- congelación: `maxTemp: -18`, `minTemp: null`
- mantenimiento en caliente: `minTemp: 63`, `maxTemp: null`
- freidoras: sin límites y `checksPerDay: 0` (se controlan con registros de aceite)
- planes: limpieza diaria, semanal (lunes) y mensual (día 1).

Errores: 400, 409 (máx. 50 locales por cuenta).

### GET `/api/orgs/{orgId}`
`200 { organization: Organization }`

### PATCH `/api/orgs/{orgId}` — owner, escritura
Cuerpo (al menos un campo): `{ name?: string; timezone?: string; reminderEnabled?: boolean; reminderHour?: 0..23 }` → `200 { organization }`.

### DELETE `/api/orgs/{orgId}` — owner (borrado DIFERIDO)
Cuerpo: `{ password: string }` → `204`. **Ya no borra al instante**: el local queda **pendiente de eliminación** durante 30 días (`organization.deletionScheduledAt` = fecha de la eliminación definitiva). Mientras tanto:
- es de **solo lectura** (402 `READ_ONLY` al escribir; `subscription.readOnly: true`), sin carta pública (404), con **todos los dispositivos de cocina revocados** (401 en `/api/kiosk/*`), sin recordatorios ni avisos de prueba, y sin Checkout (409);
- los miembros pueden seguir viendo, exportando y descargando informes;
- un owner puede **restaurarlo** (`POST /restore`) o pedir la **eliminación inmediata y definitiva** (`DELETE /permanent`);
- los owners reciben un email con la fecha de eliminación definitiva;
- al vencer el plazo, una tarea diaria lo elimina con todos sus datos.

Si el local tiene una suscripción viva en Stripe, **se cancela antes** (y queda `canceled`); si la cancelación falla → 502 `BILLING_ERROR` y el local **no** pasa a pendiente (si Stripe no está configurado en el servidor → 503 `BILLING_NOT_CONFIGURED`). **NUEVO (M-1, B-1):** si hay una sesión de Checkout abierta se **expira** en Stripe (si falla → 502 y no se marca nada), y se **revocan las invitaciones pendientes**. Si después llegara igualmente una suscripción viva para el local (pago completado en el último momento), el webhook la **cancela** en vez de activarla. Errores: 401 `INVALID_CREDENTIALS`, 403, 409 (ya pendiente), 429, 502, 503.

### POST `/api/orgs/{orgId}/restore` — owner (NUEVO)
Sin cuerpo → `200 { organization }` (con `deletionScheduledAt: null`). Cancela la eliminación pendiente. **No** reactiva la suscripción cancelada (el local queda en el estado que le corresponda: prueba vigente o solo lectura hasta contratar), ni ninguna suscripción cancelada por el webhook mientras estaba pendiente, ni el Checkout expirado, ni las invitaciones revocadas, ni los dispositivos de cocina (hay que volver a vincularlos). 409 si el local no está pendiente de eliminación; 403 para managers; **404 si la purga diaria (o una eliminación inmediata) lo ha borrado a la vez** (antes podía ser 500).

### DELETE `/api/orgs/{orgId}/permanent` — owner (NUEVO)
Cuerpo: `{ password: string }` → `204`. Eliminación **inmediata y definitiva** (derecho de supresión), solo para un local que **ya** está pendiente de eliminación (si no → 409). Irreversible. **NUEVO (M-1):** antes de borrar se consulta Stripe y, si la suscripción sigue viva, se **cancela** (y se expira cualquier Checkout abierto); si no se puede → 502 `BILLING_ERROR` («…el local NO se ha eliminado…») o 503 `BILLING_NOT_CONFIGURED`, y **no se borra nada**. La purga diaria aplica la misma regla (si falla, lo reintenta al día siguiente). Errores: 401 `INVALID_CREDENTIALS`, 403, 404 (ya borrado), 409, 429, 502, 503.

### GET `/api/orgs/{orgId}/membership`
`200 { role: 'owner' | 'manager'; dailyReminder: boolean }`

### PATCH `/api/orgs/{orgId}/membership`
Preferencia personal del recordatorio diario. Cuerpo: `{ dailyReminder: boolean }` → `200 { dailyReminder: boolean }`.

### GET `/api/orgs/{orgId}/export` — owner
Descarga JSON (`Content-Disposition: attachment; filename="exportacion-AAAA-MM-DD.json"`), generada en streaming:
```ts
{
  exportedAt: string;
  organization: {...};
  members: { id, name, email, role, created_at }[];
  staff: { id, name, active, created_at }[];
  devices: { id, name, created_at, last_used_at, revoked_at }[];
  equipment: object[]; cleaningPlans: object[]; suppliers: object[]; dishes: object[];  // filas con nombres de columna snake_case
  records: Record[];          // mismo formato que la API (ver §10)
  auditEvents: { id, event, user_id, ip, metadata, created_at }[];
}
```
No incluye hashes de contraseñas, PIN ni tokens. Queda auditado. Límite: 5 / hora por local y por usuario (429).

### Miembros e invitaciones

```ts
type Member = { userId: string; name: string; email: string; role: 'owner' | 'manager'; joinedAt: string };
type Invitation = { id: string; email: string; role: 'owner' | 'manager'; expiresAt: string; createdAt: string };
```

| Método | Ruta | Permiso | Cuerpo | Respuesta |
|---|---|---|---|---|
| GET | `/api/orgs/{orgId}/members` | miembro | – | `200 { items: Member[], nextCursor: null }` |
| PATCH | `/api/orgs/{orgId}/members/{userId}` | owner, escritura | `{ role }` | `200 { userId, role }` · 409 si deja el local sin propietario (también con cambios simultáneos) |
| DELETE | `/api/orgs/{orgId}/members/{userId}` | owner (o el propio usuario para salir) | – | `204` · 409 último propietario. **Revoca los dispositivos de cocina que creó ese miembro** (evento `device.revoked_with_member`) |
| GET | `/api/orgs/{orgId}/invitations` | owner | – | `200 { items: Invitation[], nextCursor: null }` (solo pendientes) |
| POST | `/api/orgs/{orgId}/invitations` | owner, escritura | `{ email: string; role?: 'manager' \| 'owner' (por defecto 'manager') }` | `201 { invitation: Invitation }` · 409 ya miembro · 429 límites diarios (3 al mismo email por local, 20 por local, 30 por usuario). Envía email (7 días; asunto fijo sin el nombre del local); revoca invitaciones pendientes previas al mismo email |
| DELETE | `/api/orgs/{orgId}/invitations/{invitationId}` | owner | – | `204` |

### Aceptar una invitación — `/api/invitations`

**POST `/api/invitations/preview`** (sin sesión) — Cuerpo `{ token }` →
`200 { invitation: { organizationName: string; email: string; role: 'owner'|'manager'; invitedBy: string | null; expiresAt: string } }` · 400 `INVALID_TOKEN`.

**POST `/api/invitations/accept`** (con sesión) — Cuerpo `{ token }` → `200 { organizationId: string; role: 'owner'|'manager' }`.
El email de la sesión debe coincidir con el invitado (403 si no). 400 `INVALID_TOKEN` si ya se usó/caducó/revocó **o si el local está pendiente de eliminación** (B-1: al pedir el borrado se revocan las invitaciones pendientes; `preview` también responde 400). Flujo para alguien sin cuenta: preview → registro con ese email → verificar → login → accept.

### GET `/api/orgs/{orgId}/audit` — owner
Query: `limit` (1–200), `cursor` (string numérica = `id` del último). Orden: más recientes primero.
```ts
200 { items: { id: string; event: string; user: { id: string; name: string | null } | null; ip: string | null; metadata: object; createdAt: string }[]; nextCursor: string | null }
```
Etiquetas legibles de TODOS los eventos que emite el servidor: `AUDIT_EVENT_LABELS` en `schemas/index.ts` (un test comprueba que no falta ninguno). Eventos (solo los asociados al local; los de cuenta como `auth.login` no aparecen aquí): `org.created`, `org.updated`, `org.deletion_scheduled`, `org.restored`, `org.exported`, `member.invited`, `member.role_changed`, `member.removed`, `member.joined`, `device.created`, `device.revoked`, `device.revoked_with_member`, `billing.subscription_canceled`, `staff.pin_changed`, `staff.pin_failed`, `staff.pin_locked`, `report.generated`, `billing.checkout_started`, `billing.subscription_updated`, `public_menu.updated`, `member.invitation_revoked`.

---

## 6. Personal (staff) — `/api/orgs/{orgId}/staff`

Firman los registros en cocina; no tienen login.

```ts
type Staff = { id: string; name: string; hasPin: boolean; active: boolean; lockedUntil: string | null; createdAt: string };
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/staff?active=true\|false&limit&cursor` | – | `200 Page<Staff>` |
| POST | `/staff` (escritura) | `{ name: string (1–100); pin?: string \| null }` — PIN de 4–6 dígitos | `201 { staff: Staff }` |
| PATCH | `/staff/{staffId}` (escritura) | `{ name?; pin?: string \| null; active?: boolean }` (≥1 campo). `pin: null` quita el PIN. Cambiar el PIN desbloquea | `200 { staff }` |
| POST | `/staff/{staffId}/unlock` (escritura) | – | `200 { staff }` (resetea intentos y bloqueo) |

No se borra personal (los registros lo referencian): se desactiva con `active: false`. El PIN se guarda con argon2id y nunca se devuelve.

---

## 7. Dispositivos de cocina — `/api/orgs/{orgId}/devices`

```ts
type Device = {
  id: string; name: string;
  createdByName: string | null;   // NUEVO: quien lo dio de alta (null si esa cuenta ya no existe)
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null; active: boolean;
};
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/devices?limit&cursor` | – | `200 Page<Device>` (incluye revocados) |
| POST | `/devices` (escritura) | `{ name: string (1–100) }` | `201 { device: Device; token: string }` — **el token (`kd_` + 43 caracteres) solo se muestra aquí**; guárdalo en la tablet. Máx. 20 activos (409) |
| DELETE | `/devices/{deviceId}` | – | `204` revoca (permitido también en solo lectura) |

Los dispositivos creados por un miembro se revocan automáticamente cuando sale o se le quita del local, o cuando borra su cuenta: muestra `createdByName` para que el owner sepa qué tablets dependen de quién.

---

## 8. Equipos — `/api/orgs/{orgId}/equipment`

```ts
type EquipmentType = 'camara' | 'congelador' | 'vitrina' | 'mesa_caliente' | 'abatidor' | 'freidora' | 'otro';
type Equipment = { id: string; name: string; type: EquipmentType; minTemp: number | null; maxTemp: number | null; checksPerDay: number; active: boolean; createdAt: string };
```

Los límites pueden ser solo máximo, solo mínimo, ambos o ninguno (°C, −60…300). `checksPerDay` 0–12 (0 = sin tareas de temperatura, p. ej. freidoras).

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/equipment?active=&type=&limit&cursor` | – | `200 Page<Equipment>` |
| GET | `/equipment/{equipmentId}` | – | `200 { equipment }` |
| POST | `/equipment` (escritura) | `{ name; type; minTemp?: number\|null; maxTemp?: number\|null; checksPerDay?: number (def. 1); active?: boolean (def. true) }` | `201 { equipment }` |
| PATCH | `/equipment/{equipmentId}` (escritura) | cualquier subconjunto de los campos anteriores | `200 { equipment }` |

Validación: `minTemp ≤ maxTemp` (también al combinar con los valores actuales en PATCH) → 400 con `details[0].path = "minTemp"`. Sin borrado: desactivar con `active: false`. Cada cambio de `checksPerDay`/`active` queda en un historial interno: desactivar o cambiar la frecuencia **no** altera el cumplimiento de días pasados (§13).

---

## 9. Planes de limpieza — `/api/orgs/{orgId}/cleaning-plans`

```ts
type CleaningItem = { id: string; area: string; product: string | null; method: string | null };
type CleaningPlan = {
  id: string; name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;   // 1 = lunes … 7 = domingo (solo weekly)
  monthDay: number | null;  // 1–28 (solo monthly)
  items: CleaningItem[];    // 1–100
  active: boolean; createdAt: string;
};
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/cleaning-plans?active=&limit&cursor` | – | `200 Page<CleaningPlan>` |
| GET | `/cleaning-plans/{planId}` | – | `200 { cleaningPlan }` |
| POST | `/cleaning-plans` (escritura) | `{ name; frequency; weekday?; monthDay?; items: { area: string; product?: string\|null; method?: string\|null }[]; active? }` | `201 { cleaningPlan }` |
| PATCH | `/cleaning-plans/{planId}` (escritura) | subconjunto. En `items`, incluye `id` en los ítems existentes para conservarlos; los ítems sin `id` (o con id desconocido) reciben uno nuevo | `200 { cleaningPlan }` |

`weekday` es obligatorio si `frequency = weekly`; `monthDay` si `monthly`. Los registros guardan una copia de los nombres de los ítems, así que editar un plan no altera registros pasados. Los cambios de frecuencia/día/`active` quedan en un historial interno y no alteran el cumplimiento de días pasados (§13).

---

## 10. Registros — `/api/orgs/{orgId}/records`

Registros **inmutables** (append-only, reforzado con un trigger en la BD). **Fecha del hecho:** tareas, cumplimiento, alertas, historial e informes usan `effectiveAt`; una enmienda hecha hoy de un registro de ayer cuenta ayer (no cambia el cumplimiento de ningún día). Muestra `effectiveAt` como fecha del registro y, en las enmiendas, «enmendado el `createdAt` por `user`/`staff`». No hay `PATCH`/`DELETE` (→ 404). Una corrección es una **enmienda**: un nuevo registro del mismo tipo que referencia al original, con motivo obligatorio. Solo una enmienda por registro; para volver a corregir, se enmienda la enmienda. En tareas, alertas y cumplimiento cuenta la versión vigente (la última de la cadena); los informes muestran ambas.

```ts
type RecordType = 'temperatura' | 'limpieza' | 'recepcion' | 'aceite' | 'plagas' | 'incidencia' | 'formacion';
type Record = {
  id: string;
  type: RecordType;
  data: RecordData;                                // según el tipo (abajo), ya enriquecido por el servidor
  staff: { id: string; name: string } | null;      // quién firma (personal)
  user: { id: string; name: string } | null;       // usuario que lo creó (null desde kiosko)
  deviceId: string | null;                          // dispositivo de cocina, si aplica
  alert: boolean;                                   // fuera de rango / rechazo / indicios / incidencia abierta
  amendsRecordId: string | null;                    // si es una enmienda: id del original
  amendmentReason: string | null;
  amendedByRecordId: string | null;                 // si fue corregido: id de la enmienda
  effectiveAt: string;                              // NUEVO: fecha del HECHO. Registro normal = createdAt; enmienda = la del registro original (raíz de la cadena)
  createdAt: string;                                // hora real de inserción (en una enmienda: cuándo se enmendó)
};
```

### Datos por tipo (entrada → almacenado)

**temperatura** — entrada `{ equipmentId: uuid; value: number (−60…300); correctiveAction?: string (≤1000) }`.
Si el valor queda fuera de `[minTemp, maxTemp]` del equipo, `correctiveAction` es obligatoria (400, `path: "data.correctiveAction"`). El equipo debe estar activo.
Almacenado: `{ equipmentId, equipmentName, value, minTemp, maxTemp, outOfRange: boolean, correctiveAction: string | null }`. `alert = outOfRange`.

**limpieza** — entrada `{ cleaningPlanId: uuid; items: { itemId: string; done: boolean }[]; observations?: string }`.
Los `itemId` deben pertenecer al plan, sin duplicados; los ítems no enviados cuentan como no hechos. **Al menos una zona debe estar hecha** (si no → 400 `data.items`: «Marca al menos una zona hecha»).
Almacenado: `{ cleaningPlanId, planName, items: { itemId, area, done }[], completed: boolean, observations }`. `alert = false`. Una limpieza con `completed: false` es **parcial**: se guarda, pero **no cuenta como tarea hecha** en Hoy ni en el cumplimiento (muéstrala como «Parcial (2 de 5)»).

**recepcion** — entrada `{ supplierId?: uuid; supplierName?: string; product: string; lot?: string; temperature?: number (−60…100); maxTemperature?: number (−60…100); expiryDate?: "AAAA-MM-DD"; accepted: boolean; rejectionReason?: string; correctiveAction?: string }`.
Hace falta `supplierId` o `supplierName`; si `accepted = false`, `rejectionReason` es obligatorio. Con `supplierId`, el nombre se toma del proveedor.
`maxTemperature` (NUEVO, opcional) es la temperatura máxima admisible del producto (atajos orientativos: refrigerado 4 °C, congelado −18 °C; `RECEPTION_MAX_TEMP_PRESETS`). Si se **acepta** mercancía con `temperature > maxTemperature` o con `expiryDate` anterior a hoy (fecha local del local), `correctiveAction` (motivo / acción) es obligatoria (400 `data.correctiveAction`) y el registro queda con alerta.
Almacenado: `{ supplierId, supplierName, product, lot, temperature, maxTemperature, temperatureOutOfRange, expiryDate, expired, accepted, rejectionReason, correctiveAction }`. `alert = !accepted || expired || temperatureOutOfRange`.

**aceite** — entrada `{ equipmentId: uuid (de tipo 'freidora'); action: 'revisado' | 'cambiado'; polarCompounds?: number (0–100, %); correctiveAction?: string }`.
Si `polarCompounds > 25` (umbral de referencia `POLAR_COMPOUNDS_LIMIT`), `correctiveAction` es obligatoria.
Almacenado: `{ equipmentId, fryerName, action, polarCompounds, overLimit, correctiveAction }`. `alert = overLimit`.

**plagas** — entrada `{ result: 'sin_indicios' | 'con_indicios'; description?: string; action?: string }` (con indicios: `description` y `action` obligatorias).
Almacenado igual. `alert = result === 'con_indicios'`.

**incidencia** — entrada `{ description: string (1–2000); correctiveAction?: string; closed: boolean }`.
Almacenado igual. `alert = !closed`. Para **cerrar** una incidencia: crea una enmienda con `closed: true`.

**formacion** (formación de manipuladores) — entrada `{ traineeStaffId: uuid; course: string (1–300); trainingDate: "AAAA-MM-DD" (no futura, según la fecha local del local); trainer?: string; hours?: number (0–1000) }`.
Almacenado: `{ traineeStaffId, traineeName, course, trainingDate, trainer, hours }`. `alert = false`.

En la entrada, los textos opcionales vacíos se guardan como `null`.

### GET `/records`
Query: `type?`, `from?` y `to?` (`AAAA-MM-DD`, fechas locales del local, inclusive; se comparan con `effectiveAt`), `equipmentId?`, `staffId?`, `alert?` (`true`/`false`), `limit`, `cursor`. → `200 Page<Record>` ordenado por `effectiveAt` descendente (más recientes primero; una enmienda aparece junto a su original).

### GET `/records/{recordId}`
`200 { record: Record; amends: Record | null; amendedBy: Record | null }`

### POST `/records` — escritura
Cuerpo: `{ type: RecordType; data: <entrada del tipo>; staffId?: uuid | null }` → `201 { record: Record }` (o `200` si es una repetición con la misma `Idempotency-Key`, §1.7).
`staffId` (opcional desde la web) indica qué miembro del personal firma; debe ser del local y estar activo. El usuario autenticado siempre queda registrado en `user`.
Errores: 400 `VALIDATION_ERROR` (paths con prefijo `data.`), 404 si `equipmentId`/`cleaningPlanId`/`supplierId`/`traineeStaffId`/`staffId` no son del local, 402 `READ_ONLY`, 409 (clave de idempotencia con otro cuerpo), 429 (más de 120 altas por minuto del mismo usuario en el local).

### POST `/records/{recordId}/amendments` — escritura
Cuerpo: `{ reason: string (1–1000); data: <entrada COMPLETA del tipo del original>; staffId?: uuid | null }` → `201 { record: Record }` (con `amendsRecordId`, `amendmentReason` y `effectiveAt` = el del original; `200` en una repetición con la misma `Idempotency-Key`).
Errores: 400, 404, 409 `CONFLICT` si el registro ya tiene enmienda (o clave de idempotencia con otro cuerpo), 429 (comparte el límite de 120/min con las altas).

---

## 11. Proveedores — `/api/orgs/{orgId}/suppliers`

```ts
type Supplier = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; products: string[]; notes: string | null; createdAt: string };
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/suppliers?q=&limit&cursor` | – (`q` busca en el nombre) | `200 Page<Supplier>` |
| GET | `/suppliers/{supplierId}` | – | `200 { supplier }` |
| POST | `/suppliers` (escritura) | `{ name (1–150); contactName?; phone?; email? (válido o ""); products?: string[] (≤200); notes? }` | `201 { supplier }` |
| PATCH | `/suppliers/{supplierId}` (escritura) | subconjunto | `200 { supplier }` |
| DELETE | `/suppliers/{supplierId}` (escritura) | – | `204` (los registros conservan el nombre) |

---

## 12. Alérgenos y carta pública

Los 14 alérgenos del Anexo II del Reglamento (UE) 1169/2011, en este orden (identificador → etiqueta):

| id | etiqueta |
|---|---|
| `gluten` | Cereales que contienen gluten |
| `crustaceans` | Crustáceos |
| `eggs` | Huevos |
| `fish` | Pescado |
| `peanuts` | Cacahuetes |
| `soybeans` | Soja |
| `milk` | Leche |
| `nuts` | Frutos de cáscara |
| `celery` | Apio |
| `mustard` | Mostaza |
| `sesame` | Granos de sésamo |
| `sulphites` | Dióxido de azufre y sulfitos |
| `lupin` | Altramuces |
| `molluscs` | Moluscos |

Estado por alérgeno: `'contains'` (Contiene) · `'traces'` (Puede contener trazas) · `'no'` (No contiene).

```ts
type AllergenMap = Record<'gluten' | 'crustaceans' | … | 'molluscs', 'contains' | 'traces' | 'no'>; // los 14, obligatorios
type Dish = {
  id: string; name: string; category: string | null; description: string | null; allergens: AllergenMap;
  allergensReviewed: boolean;        // NUEVO: revisión explícita de los 14 alérgenos
  allergensReviewedAt: string | null; // NUEVO
  visible: boolean; createdAt: string; updatedAt: string;
};
```

**Revisión de alérgenos (NUEVO, migración 0004).** Un plato nace **sin revisar** (`allergensReviewed: false`, valor por defecto en `POST`) y **no aparece en la carta pública** hasta que alguien envía `allergensReviewed: true` (en `POST` o `PATCH`), es decir, hasta que confirma que ha decidido los 14 alérgenos (o que no contiene ninguno). En la migración, los platos existentes quedan revisados solo si tienen algún alérgeno marcado («contiene» o «trazas»); los que tenían los 14 en «no» pasan a pendientes. Nombres cortos de los alérgenos, iguales en todas las vistas: `ALLERGEN_NAMES` (p. ej. «Gluten», «Sulfitos»); `ALLERGEN_LABELS` sigue siendo la denominación completa del Reglamento.

```ts
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/orgs/{orgId}/dishes?category=&limit&cursor` | – | `200 Page<Dish>` |
| GET | `/api/orgs/{orgId}/dishes/{dishId}` | – | `200 { dish }` |
| POST | `/api/orgs/{orgId}/dishes` (escritura) | `{ name (1–150); category?; description?; allergens: AllergenMap (los 14 exactos); visible?: boolean (def. true) }` | `201 { dish }` |
| PATCH | `/api/orgs/{orgId}/dishes/{dishId}` (escritura) | subconjunto (si se envía `allergens`, los 14) | `200 { dish }` |
| DELETE | `/api/orgs/{orgId}/dishes/{dishId}` (escritura) | – | `204` |
| GET | `/api/orgs/{orgId}/public-menu` | – | `200 { publicMenu: { enabled: boolean; slug: string; apiPath: string } }` |
| PATCH | `/api/orgs/{orgId}/public-menu` | `{ enabled: boolean }` | `200 { publicMenu }` — `enabled: true` exige escritura (402 en solo lectura); **`enabled: false` se permite siempre** |
| POST | `/api/orgs/{orgId}/public-menu/regenerate` (escritura) | – | `200 { publicMenu }` — slug nuevo; el QR anterior deja de funcionar |

### GET `/api/public/menu/{slug}` (público, sin autenticación)
El slug son 22 caracteres aleatorios (128 bits). Para el QR, la SPA debe tener una ruta pública (p. ej. `/carta/{slug}`) que llame a este endpoint.
```ts
200 {
  organization: { name: string };
  allergens: { id: AllergenId; label: string; name: string }[]; // leyenda, en el orden oficial (name = nombre corto, NUEVO)
  statuses: { contains: 'Contiene'; traces: 'Puede contener trazas'; no: 'No contiene' };
  dishes: { name: string; category: string | null; description: string | null; allergens: AllergenMap }[]; // solo visibles Y revisados, en orden de carta (entrantes → principales → otras → postres → bebidas → sin categoría; `compareMenuCategories`) y nombre
  updatedAt: string | null;
  notice: string;                                             // aviso para mostrar al cliente
}
```
`notice` advierte siempre de consultar al personal y de posibles trazas por contaminación cruzada: muéstralo siempre visible y no digas nunca «Sin alérgenos» de forma tajante (usa «No se han declarado alérgenos en este plato»).
404 si el slug no existe, la carta está desactivada **o el local está en solo lectura** (prueba caducada, impago definitivo, cancelada, pendiente de eliminación). Sin ids ni datos internos. Cabecera `X-Robots-Tag: noindex, nofollow`. Límite 120/min por IP.

---

## 13. Tareas de hoy y cumplimiento — `/api/orgs/{orgId}/tasks`

### GET `/tasks/today`
"Hoy" es la fecha local en la zona horaria del local.
```ts
200 {
  date: string;              // AAAA-MM-DD local
  timezone: string;
  temperatures: {
    equipmentId: string; name: string; type: EquipmentType; minTemp: number | null; maxTemp: number | null;
    required: number;        // checksPerDay
    done: number;            // lecturas vigentes de hoy (máx. required)
    status: 'done' | 'pending';
    countsToday: boolean;    // NUEVO: false si el equipo se dio de alta o se reactivó HOY: se muestra (y lo registrado figura como hecho) pero no es exigible ni cuenta en `summary`
    correctedLater: number;  // NUEVO (I-1): lecturas de `done` que solo cuentan por correcciones de un día posterior
    lastReading: { value: number; outOfRange: boolean; at: string } | null;   // `at` = effectiveAt
  }[];                       // equipos activos con checksPerDay > 0
  cleaning: {
    cleaningPlanId: string; name: string; frequency: 'daily' | 'weekly' | 'monthly';
    status: 'done' | 'pending';
    countsToday: boolean;    // NUEVO: igual que en temperatures
    completedAt: string | null;   // effectiveAt del registro COMPLETO (las parciales no cuentan)
    correctedLater: boolean;      // NUEVO (I-1): hecha solo gracias a una corrección registrada en un día posterior al del hecho
    partial: { done: number; total: number; at: string; recordId: string } | null; // NUEVO: última limpieza parcial del periodo si aún no hay una completa
  }[];                       // planes activos que tocan hoy
  summary: { total: number; done: number; pending: number; percent: number;   // solo elementos con countsToday
             correctedLater: number };   // NUEVO (I-1): de `done`, cuántas tareas cuentan solo gracias a una CORRECCIÓN registrada en un día posterior al del hecho (informativo; no cambia el cálculo)
  alerts: {
    kind: 'temperatura_fuera_de_rango' | 'aceite_fuera_de_limite' | 'recepcion_rechazada' | 'recepcion_con_incidencia' /* NUEVO: aceptada caducada o por encima de la máxima */ | 'plagas_con_indicios' | 'incidencia_abierta';
    recordId: string; message: string; createdAt: string;
  }[];                       // alertas de hoy + incidencias abiertas de cualquier fecha (máx. 50 + 50)
}
```
Los mensajes de las alertas usan formato es-ES («3,5 °C», «−18 °C», «al 27 %»). Reglas: un plan semanal toca el `weekday` indicado; uno mensual, el `monthDay`. Se considera hecho si hay un registro de limpieza **completo** del plan (por `effectiveAt`) desde el inicio de su periodo (lunes de la semana / día 1 del mes / hoy) hasta hoy. Las lecturas sustituidas por una enmienda no cuentan; la enmienda cuenta en el día del original. Las alertas «de hoy» son las de registros cuyo hecho es de hoy; `createdAt` de cada alerta = `effectiveAt`.

### GET `/tasks/compliance?from=AAAA-MM-DD&to=AAAA-MM-DD`
Rango máximo 92 días; los días futuros se omiten.
```ts
200 {
  from: string; to: string;
  days: { date: string; expected: number; done: number; percent: number | null; correctedLater: number }[]; // percent null si no había nada previsto
  overall: { expected: number; done: number; percent: number | null; correctedLater: number };
}
```
Lo esperado de cada día sale de la **configuración vigente ese día** (historial de equipos y planes): un equipo/plan se exige un día si estaba activo al empezar el día y sigue activo al terminarlo (o ahora, si es hoy), con la frecuencia vigente al final del día. Así, desactivarlo, reactivarlo o cambiar su frecuencia no reescribe el pasado, y el día de alta (o de reactivación/desactivación) no es exigible. Los registros cuentan por `effectiveAt`.
**`correctedLater` (NUEVO, I-1):** cuántas de las tareas `done` de ese día solo se cumplen gracias a una enmienda cuya fecha real de registro (`createdAt`, en la zona del local) es de un día **posterior** al del hecho. No cambia `done` ni `percent`; sirve para mostrar, p. ej., «2 cumplidas con corrección posterior» junto al porcentaje del día.

---

## 14. Informes — `/api/orgs/{orgId}/reports`

Query común: `from`, `to` (`AAAA-MM-DD`, inclusive, máx. 366 días) y `types` opcional (lista separada por comas de `RecordType`; vacío = todos). Disponibles para owner y manager, también en solo lectura. Quedan auditados.

### GET `/reports/pdf`
`200 application/pdf` con `Content-Disposition: attachment; filename="registros-{local}-{from}-a-{to}.pdf"`. A4 apaisado: cabecera con local, tipo, zona horaria con nombre legible («Hora peninsular y de Baleares», `timezoneLabel`), periodo y tipos; formatos es-ES (coma decimal, signo «−», «máx./mín.» en vez de «<=/>=»); limpiezas como «Completa (5 de 5)» o «Parcial (2 de 5)»; en el original corregido, «Corregido el … por …» (sin ids internos); una tabla por tipo (ordenada por fecha del hecho); «Fecha y hora» = fecha del **hecho** (`effectiveAt`); filas fuera de rango en rojo; enmiendas destacadas con su motivo, referencia cruzada y **cuándo y por quién** se enmendó; pie con fecha de generación y número de página. Fuente Unicode embebida: los textos salen completos (sin «…»; las celdas largas continúan en la página siguiente) y con cualquier letra latina, griega o cirílica; los caracteres sin glifo (muchos emojis, CJK) salen como `□`. Respuesta con `Content-Length` (el PDF se genera entero antes de enviarse). **Máximo 5000 registros**: si el periodo/tipos superan esa cifra → 400 `REPORT_TOO_LARGE` (mensaje: acota fechas o tipos, o usa el CSV), antes de empezar a generar. **NUEVO (I-1):** si en el periodo hay días con tareas cumplidas mediante una corrección hecha en un día posterior, el PDF incluye tras la cabecera el apartado «Cumplimiento completado con correcciones posteriores», con una nota por día («3 de noviembre de 2026: 1 tarea(s) cumplida(s) mediante una corrección hecha en un día posterior (cumplimiento del día: X de Y)»). Se genera en un `worker_thread` y se envía completo. Límites (B-2, ver 1.6): 10 / 10 min por local y por usuario; **1 PDF a la vez por local y por usuario** (429 propio); 180 s de generación por local y hora (429); y como mucho 2 PDF a la vez en el servidor, con **cola de espera de hasta 20 s** por orden de llegada antes del 429. La petición puede tardar, por tanto, hasta ~20 s más de lo habitual en responder: el frontend debe mostrar «Generando…» sin un timeout corto.

### GET `/reports/csv`
`200 text/csv; charset=utf-8` (con BOM UTF-8, separador `;`, decimales con coma, todas las celdas entre comillas; pensado para Excel en español). Columnas: `id, tipo, fecha_hora (fecha del HECHO), firmado_por_personal, firmado_por_usuario, dispositivo_cocina, alerta, enmienda_de, motivo_enmienda, corregido_por, equipo, valor_c, minimo_c, maximo_c, accion_correctora, plan_limpieza, items_realizados, items_no_realizados, observaciones, proveedor, producto, lote, temperatura_c, caducidad, resultado, motivo_rechazo, accion_aceite, compuestos_polares_pct, descripcion, accion, estado, persona_formada, curso, fecha_formacion, formador, horas, fecha_registro, enmendado_por, estado_limpieza, temperatura_maxima_c, caducada` (las cinco últimas añadidas al final, por compatibilidad: hora real de inserción; en enmiendas, quién enmendó; «completa» o «parcial (2 de 5)»; temperatura máxima admisible de la recepción; «sí/no» si la mercancía estaba caducada). En el CSV los números negativos usan el guion ASCII («-18,5») para que Excel los reconozca como números. Orden por fecha del hecho. Las celdas que empiezan por `= + - @` (salvo números) llevan el prefijo `'` para evitar inyección de fórmulas.

Límite CSV: 20 / 10 min por local y por usuario. Máximo 500 000 filas: si se superarían → 400 `REPORT_TOO_LARGE` **antes** de empezar (antes se cortaba en silencio).

Errores (ambos): 400 si faltan fechas, `from > to`, rango > 1 año, años fuera de 2000–2100 o tipo desconocido; 429 por los límites anteriores.

---

## 15. Facturación (Stripe)

Precios: 12 €/mes o 120 €/año por local. Prueba de 14 días sin tarjeta al crear el local.

### GET `/api/orgs/{orgId}/billing` (miembro)
```ts
200 {
  billingEnabled: boolean;   // false si el servidor no tiene Stripe configurado
  prices: { monthly: { amount: 12; currency: 'EUR'; interval: 'month' }; annual: { amount: 120; currency: 'EUR'; interval: 'year' } };
  subscription: Subscription;
}
```

### POST `/api/orgs/{orgId}/billing/checkout` (owner; permitido en solo lectura)
Cuerpo: `{ plan: 'monthly' | 'annual' }` → `200 { url: string }`. Redirige el navegador a `url` (`window.location.href = url`). Si quedan ≥ 48 h de prueba, la suscripción empieza a cobrar al terminar la prueba.
Retorno: `{APP_URL}/locales/{orgId}/facturacion?checkout=ok` o `?checkout=cancelado`. El estado se actualiza por webhook (puede tardar unos segundos): vuelve a pedir `GET /billing` o `GET /api/orgs/{orgId}`.
**NUEVO (M-2):** si el local tiene una suscripción `incomplete` (primer pago a medias), se **anula** en Stripe antes de abrir el nuevo Checkout (si Stripe dice que ya se pagó → 409 «espera unos segundos y recarga»; si no se puede anular → 502 «No se ha podido anular el intento de pago anterior…»). Solo hay una sesión de Checkout abierta por local: la anterior se expira al pedir otra.
Errores: 403 (manager), 409 si ya existe una suscripción (usar el portal) o el local está pendiente de eliminación, 502 `BILLING_ERROR`, 503 `BILLING_NOT_CONFIGURED`.

### POST `/api/orgs/{orgId}/billing/portal` (owner)
Sin cuerpo → `200 { url: string }` (portal de cliente de Stripe: cambiar tarjeta, plan, cancelar, facturas). Vuelve a `{APP_URL}/locales/{orgId}/facturacion`.
Errores: 409 si no hay cliente de Stripe todavía, 502, 503.

### POST `/api/billing/webhook` (solo Stripe)
Firma `Stripe-Signature` verificada sobre el cuerpo crudo; idempotente por id de evento. Eventos usados: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.*` (p. ej. `invoice.paid`, `invoice.payment_failed`). En cada uno se **recupera la suscripción actual de Stripe** y se aplica su estado. Respuesta `200 { received: true, duplicate: boolean }`; 400 si la firma no es válida; **503 sin marcar el evento** (Stripe reintenta) si Stripe falla o el local aún no se puede identificar; 503 `BILLING_NOT_CONFIGURED` sin Stripe. Eventos de un local ya eliminado o de una suscripción que no es la actual del local → 200 sin efecto. **NUEVO (M-1, M-2, B-6):** (1) una suscripción **viva** de un local ya eliminado o pendiente de eliminación se **cancela** en Stripe (sin reembolso automático; queda en el log y en la auditoría como `billing.subscription_canceled` con `refund: 'manual_review'`); (2) una suscripción viva (`active`/`trialing`/`past_due`) **sustituye** a la actual si esta no está viva (p. ej. `incomplete` o `unpaid`), y la anterior se cancela; (3) nunca dos suscripciones vivas por local: se conserva la más reciente y se cancela la otra (log + auditoría, `reason: 'duplicate_subscription'`); si una cancelación falla → 503 y Stripe reintenta; (4) si el cliente de Stripe ya pertenece a otro local → 200, evento marcado como procesado y aviso en el log (antes 500).

**Estados y solo lectura**: `active`, `trialing`, **`past_due`** (periodo de gracia mientras Stripe reintenta el cobro, **como mucho 21 días**: pasado ese plazo, `readOnly: true` aunque Stripe no la haya cancelado — ver `pastDueSince`; `paymentFailed: true` → muestra un aviso «No hemos podido cobrar tu suscripción: actualiza el método de pago» con botón al portal) e `incomplete` (primer pago en curso) permiten escribir. `trial_expired` (prueba local caducada), `unpaid`, `canceled`, `incomplete_expired` y `paused` → solo lectura (402 `READ_ONLY` al escribir). Muestra un banner con un botón a Checkout (o al portal si `hasBillingAccount`). Checkout responde 409 si el local está pendiente de eliminación.

---

## 16. Modo cocina (kiosko) — `/api/kiosk`

Pensado para una tablet fija en cocina, **sin sesión de usuario**. Autenticación: cabecera `Authorization: Bearer <token del dispositivo>` (el `token` devuelto al crear el dispositivo). Sin cookies ni cabeceras CSRF. Mínimo privilegio: solo estas tres rutas; no puede ver ajustes, facturación, usuarios, registros existentes ni borrar nada. Un token revocado responde 401 `UNAUTHENTICATED` → la tablet debe pedir que un encargado la vuelva a vincular.

Flujo recomendado:
1. Un owner/manager crea el dispositivo desde la web (`POST /api/orgs/{orgId}/devices`) y la SPA muestra el token **una vez** (o lo guarda directamente en el `localStorage` de esa tablet si se configura desde la propia tablet).
2. La tablet llama a `GET /api/kiosk/context` y `GET /api/kiosk/tasks/today`.
3. El cocinero elige su nombre; si `hasPin`, teclea su PIN; se envía `POST /api/kiosk/records`.

### GET `/api/kiosk/context`
```ts
200 {
  device: { id: string; name: string };
  organization: { id: string; name: string; timezone: string; readOnly: boolean };
  staff: { id: string; name: string; hasPin: boolean }[];                     // solo activos
  equipment: { id; name; type; minTemp; maxTemp; checksPerDay }[];            // solo activos
  cleaningPlans: { id; name; frequency; weekday; monthDay; items: CleaningItem[] }[]; // solo activos
  suppliers: { id: string; name: string; products: string[] }[];
}
```

### GET `/api/kiosk/tasks/today`
Misma respuesta que `GET /api/orgs/{orgId}/tasks/today`.

### POST `/api/kiosk/verify-pin` (NUEVO)
Cuerpo: `{ staffId: uuid; pin: string }` → `200 { staff: { id, name, hasPin } }`. Comprueba el PIN **al identificarse** en la tablet, antes de registrar nada, con los **mismos contadores atómicos** de fallos y bloqueo que el alta (5 fallos → 429 `PIN_LOCKED` 15 min; nunca se comprueban más de 5 PIN erróneos por ventana aunque lleguen en ráfaga) y los mismos límites por dispositivo (30 intentos / 15 min; 20 erróneos / 15 min). Errores: 401 `PIN_REQUIRED` (pin vacío), 401 `INVALID_PIN`, 429 `PIN_LOCKED`/`RATE_LIMITED`, 404, 400 (personal desactivado), 401 `UNAUTHENTICATED` (dispositivo revocado). Para personal sin PIN responde 200 directamente. El alta (`POST /records`) **sigue exigiendo y verificando** el PIN.

### POST `/api/kiosk/records`
Cuerpo: `{ staffId: uuid; pin?: string; type: RecordType; data: <entrada del tipo> }` → `201 { record: Record }` (`user: null`, `deviceId` del dispositivo). Admite `Idempotency-Key` (§1.7; muy recomendable en la tablet, que reintenta con mala cobertura): una repetición devuelve `200` con el mismo registro.
- Si el miembro tiene PIN: sin `pin` → 401 `PIN_REQUIRED`; incorrecto → 401 `INVALID_PIN`; al 5.º fallo consecutivo → 429 `PIN_LOCKED` durante 15 min (`Retry-After`). El límite es estricto incluso con peticiones simultáneas (nunca se comprueban más de 5 PIN erróneos por ventana). Un encargado puede desbloquear con `POST /staff/{id}/unlock` o cambiando el PIN.
- Por dispositivo: más de 20 PIN erróneos en 15 min (sumando todas las personas) → 429 `RATE_LIMITED` también para PIN correctos hasta que pase la ventana; más de 120 registros/min → 429 `RATE_LIMITED`.
- 404 si `staffId` (u otros ids del `data`) no son del local; 400 si está desactivado o los datos no son válidos; 402 `READ_ONLY` si la suscripción no está activa.
- Las enmiendas no están disponibles desde el kiosko (se hacen desde la web).

---

## 17. Resumen de rutas

| Método | Ruta | Auth |
|---|---|---|
| GET | `/healthz`, `/readyz` | – |
| POST | `/api/auth/register` · `/verify-email` · `/resend-verification` · `/login` · `/logout` · `/password-reset/request` · `/password-reset/confirm` · `/email-change/confirm` | – |
| POST | `/api/auth/logout-all` | sesión |
| GET/PATCH/DELETE | `/api/account` | sesión |
| POST | `/api/account/password` · `/api/account/email` | sesión |
| POST | `/api/invitations/preview` | – |
| POST | `/api/invitations/accept` | sesión |
| GET/POST | `/api/orgs` | sesión |
| GET/PATCH/DELETE | `/api/orgs/{orgId}` | miembro (PATCH/DELETE owner) |
| POST · DELETE | `/api/orgs/{orgId}/restore` · `/api/orgs/{orgId}/permanent` | owner |
| GET/PATCH | `/api/orgs/{orgId}/membership` | miembro |
| GET | `/api/orgs/{orgId}/export` · `/audit` | owner |
| GET · PATCH/DELETE | `/api/orgs/{orgId}/members` · `/members/{userId}` | miembro · owner |
| GET/POST · DELETE | `/api/orgs/{orgId}/invitations` · `/invitations/{id}` | owner |
| GET/POST · PATCH · POST | `/api/orgs/{orgId}/staff` · `/staff/{id}` · `/staff/{id}/unlock` | miembro |
| GET/POST · DELETE | `/api/orgs/{orgId}/devices` · `/devices/{id}` | miembro |
| GET/POST · GET/PATCH | `/api/orgs/{orgId}/equipment` · `/equipment/{id}` | miembro |
| GET/POST · GET/PATCH | `/api/orgs/{orgId}/cleaning-plans` · `/cleaning-plans/{id}` | miembro |
| GET/POST · GET/PATCH/DELETE | `/api/orgs/{orgId}/suppliers` · `/suppliers/{id}` | miembro |
| GET/POST · GET · POST | `/api/orgs/{orgId}/records` · `/records/{id}` · `/records/{id}/amendments` | miembro |
| GET/POST · GET/PATCH/DELETE | `/api/orgs/{orgId}/dishes` · `/dishes/{id}` | miembro |
| GET/PATCH · POST | `/api/orgs/{orgId}/public-menu` · `/public-menu/regenerate` | miembro |
| GET | `/api/orgs/{orgId}/tasks/today` · `/tasks/compliance` | miembro |
| GET | `/api/orgs/{orgId}/reports/pdf` · `/reports/csv` | miembro |
| GET · POST | `/api/orgs/{orgId}/billing` · `/billing/checkout`, `/billing/portal` | miembro · owner |
| POST | `/api/billing/webhook` | firma Stripe |
| GET · POST | `/api/kiosk/context`, `/api/kiosk/tasks/today` · `/api/kiosk/records`, `/api/kiosk/verify-pin` | Bearer de dispositivo |
| GET | `/api/public/menu/{slug}` | – |

"miembro" = owner o manager. Las rutas que crean o modifican datos exigen además que la suscripción permita escritura (§5).

---

## 18. Cambios de esta versión que afectan al frontend

Todos son **aditivos** salvo el cambio de comportamiento de `DELETE /api/orgs/{orgId}` y de `past_due`.

1. **Borrado diferido de locales.** Tras `DELETE /api/orgs/{orgId}` (204) el local **sigue existiendo**: no lo quites de la lista ni redirijas como si se hubiera borrado; recárgalo. Si `organization.deletionScheduledAt` no es `null`, muestra un banner «Este local se eliminará definitivamente el {fecha}» con botones «Restaurar» (`POST /restore`, solo owner) y «Eliminar ya definitivamente» (`DELETE /permanent` con contraseña, solo owner, confirmación fuerte). En ese estado: formularios deshabilitados (solo lectura), Checkout oculto, informes/exportación disponibles. `GET /api/account` también trae `deletionScheduledAt` por local (para marcarlo en el selector). Los textos de confirmación del borrado deben decir que hay 30 días para restaurar.
2. **`past_due` ya no es solo lectura.** Usa `subscription.paymentFailed` para mostrar un aviso de pago fallido (con enlace al portal) sin deshabilitar nada. `incomplete` también es escribible.
3. **Fecha del hecho.** `Record.effectiveAt` es la fecha que debe mostrarse como fecha del registro (historial, detalle); en enmiendas, muestra aparte «enmendado el `createdAt` por …». El historial ya viene ordenado y filtrado por `effectiveAt`.
4. **Tareas de hoy.** Nuevo `countsToday` en `temperatures[]` y `cleaning[]`: si es `false` (alta o reactivación hoy) muéstralo como «opcional hoy / empieza a contar mañana»; `summary` ya lo excluye.
5. **Idempotencia.** Envía `Idempotency-Key: crypto.randomUUID()` (una por registro, reutilizada en reintentos) en `POST /records`, en las enmiendas y, sobre todo, en `POST /api/kiosk/records`. Trata `200` como éxito igual que `201`.
6. **CSV**: puede responder `400 REPORT_TOO_LARGE` (muestra `error.message`). Tiene dos columnas nuevas al final.
7. **Auditoría**: nuevos eventos `org.deletion_scheduled` y `org.restored` (añade sus etiquetas).
8. **Rutas de la SPA**: `GET /` y cualquier ruta de la SPA devuelven `index.html` con cualquier `Accept`; `X-Robots-Tag: noindex, nofollow` se aplica por **lista blanca** (I-4): solo `/`, `/aviso-legal`, `/privacidad`, `/terminos` y `/cookies` (ruta exacta, con o sin query) son indexables; cualquier otra ruta, incluidas variantes como `/Locales/x`, `//locales/x` o `/locales%2Fx`, lleva `noindex`. Si se añade una página pública nueva que deba indexarse, hay que añadirla a `INDEXABLE_PATHS` (`server/src/app.ts`).

---

## 19. Cambios de la ronda previa al lanzamiento

Todos aditivos salvo donde se indica (reglas de validación más estrictas).

1. **Mensajes de validación en español** en todos los 400 (zod incluido), con el nombre del campo; `error.message` resume el primer error (§1.1).
2. **Contraseñas**: solo se rechaza la coincidencia exacta con comunes / email / nombre; mensajes que explican el motivo (§3).
3. **Limpieza** (más estricta): al menos una zona hecha; una limpieza parcial no cuenta como hecha (`tasks/today` → `partial`; cumplimiento) (§10, §13).
4. **Recepción**: `maxTemperature`, `expired`, `temperatureOutOfRange`, `correctiveAction` obligatoria al aceptar mercancía caducada o demasiado caliente; nueva alerta `recepcion_con_incidencia` (§10, §13).
5. **Formación** (más estricta): sin fechas futuras; horas no negativas.
6. **Alérgenos**: `allergensReviewed`/`allergensReviewedAt`; la carta pública solo muestra platos revisados, en orden de carta, con aviso de trazas; `ALLERGEN_NAMES` (§12). Migración `0004_allergen_review.sql`.
7. **Kiosko**: `POST /api/kiosk/verify-pin` (§16).
8. **Emails**: si se configura `SUPPORT_EMAIL` en el servidor (opcional), todos los emails terminan con «¿Necesitas ayuda? Escríbenos a …».
9. **PDF/CSV**: textos sin ids internos, zona horaria legible, formatos es-ES, columnas CSV nuevas al final (§14).
10. **`INVALID_TOKEN`**: un único mensaje completo y bien puntuado (§1.1).
11. **Auditoría**: `AUDIT_EVENT_LABELS` con la etiqueta de todos los eventos (§5).

