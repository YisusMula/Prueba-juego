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

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo/query no válidos (zod) o regla de negocio de validación (p. ej. falta acción correctora). Incluye `details`. |
| 400 | `BAD_REQUEST` | JSON malformado, rango de fechas excesivo, petición incoherente. |
| 400 | `INVALID_TOKEN` | Token de email/invitación inválido, caducado o ya usado. |
| 401 | `UNAUTHENTICATED` | Falta sesión (o token de kiosko) o ha caducado. |
| 401 | `INVALID_CREDENTIALS` | Email/contraseña incorrectos, o contraseña de reautenticación incorrecta. |
| 401 | `PIN_REQUIRED` | Kiosko: el miembro del personal tiene PIN y no se ha enviado. |
| 401 | `INVALID_PIN` | Kiosko: PIN incorrecto. |
| 402 | `READ_ONLY` | La suscripción del local no está activa: solo lectura. |
| 403 | `EMAIL_NOT_VERIFIED` | Login con email sin verificar (se reenvía el enlace automáticamente). |
| 403 | `FORBIDDEN` | Autenticado y miembro, pero sin el rol necesario (p. ej. manager en acción de owner). |
| 403 | `CSRF_FAILED` | Falta `X-Requested-With` u `Origin` no permitido. |
| 404 | `NOT_FOUND` | Recurso inexistente **o de otra organización** (nunca se revela si existe). También rutas desconocidas. |
| 409 | `CONFLICT` | Estado incompatible (último propietario, enmienda duplicada, ya miembro, ya suscrito…). |
| 415 | `BAD_REQUEST` | `Content-Type` no admitido (usa `application/json`). No envíes `Content-Type: application/json` con cuerpo vacío (→ 400). |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo > 256 KiB (1 MiB en el webhook). |
| 400 | `REPORT_TOO_LARGE` | Informe PDF con más de 5000 registros: acota fechas/tipos o usa el CSV. |
| 429 | `RATE_LIMITED` | Límite de peticiones (o servidor ocupado generando PDF). Cabecera `Retry-After` (segundos). Muestra `error.message`, que explica el motivo. |
| 429 | `PIN_LOCKED` | Kiosko: PIN bloqueado tras 5 fallos (15 min). Cabecera `Retry-After`. |
| 502 | `BILLING_ERROR` | Fallo al hablar con Stripe (también al cancelar la suscripción cuando se elimina un local: el local NO se elimina). |
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
| PDF generándose a la vez en el servidor | 2; si están ocupados → 429 inmediato con `Retry-After` (reintenta después) |
| Invitaciones al mismo email por local | 3 / día |
| Invitaciones por local | 20 / día |
| Invitaciones por usuario (todos sus locales) | 30 / día |

---

## 2. Salud

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/healthz` | `200 { "status": "ok" }` (proceso vivo) |
| GET | `/readyz` | `200 { "status": "ok" }` o `503 { "status": "unavailable" }` (comprueba la BD) |

---

## 3. Autenticación — `/api/auth` (sin sesión previa)

Respuestas que no revelan si un email existe: registro, reenvío y recuperación responden siempre igual.

```ts
type User = { id: string; email: string; name: string; emailVerified: boolean; createdAt?: string };
```

### POST `/api/auth/register`
Cuerpo: `{ email: string; password: string; name: string }`
- `email`: se normaliza (trim + minúsculas), máx. 254.
- `password`: 10–128 caracteres; se rechazan contraseñas muy comunes, un único carácter repetido o basadas en el email.
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
Cuerpo: `{ token: string }` → `200 { "message": "Email actualizado." }`. Se avisa al email anterior.
Errores: 400 `INVALID_TOKEN`, 409 `CONFLICT` (el email ya lo usa otra cuenta).

---

## 4. Cuenta — `/api/account` (requiere sesión)

### GET `/api/account`
```ts
200 {
  user: User;
  organizations: { id: string; name: string; businessType: BusinessType; role: 'owner' | 'manager'; subscription: Subscription }[];
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
Errores: 401 `INVALID_CREDENTIALS`, 409 `CONFLICT` si es el único propietario de algún local (debe eliminar el local o nombrar otro propietario antes).

---

## 5. Organizaciones (locales)

```ts
type BusinessType = 'bar' | 'restaurante' | 'cafeteria' | 'obrador' | 'catering' | 'tienda';
type Subscription = {
  status: 'trialing' | 'trial_expired' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused';
  readOnly: boolean;          // true salvo 'active' o 'trialing'
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
  createdAt: string;
};
```

**Roles.** `owner`: todo. `manager`: todo lo operativo (registros, personal, equipos, limpieza, proveedores, platos/carta, dispositivos, informes, tareas) pero **no**: editar ajustes del local, gestionar miembros/invitaciones, facturación, exportación RGPD, auditoría ni borrar el local (→ 403 `FORBIDDEN`).

**Solo lectura.** Si `subscription.readOnly` es `true`, toda creación/edición responde 402 `READ_ONLY`. Siguen permitidos: todas las lecturas, informes PDF/CSV, exportación, facturación (checkout/portal), revocar dispositivos, quitar miembros/salir, preferencias personales, **desactivar la carta pública** y eliminar el local. Mientras está en solo lectura, la carta pública **no se sirve** (404) aunque esté activada; vuelve a servirse al reactivar la suscripción.

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

### DELETE `/api/orgs/{orgId}` — owner
Cuerpo: `{ password: string }` → `204`. Borra el local y **todos** sus datos (irreversible). Si el local tiene una suscripción viva en Stripe, **se cancela antes**; si la cancelación falla → 502 `BILLING_ERROR` y el local **no** se borra (si Stripe no está configurado en el servidor → 503 `BILLING_NOT_CONFIGURED`, tampoco se borra). Errores: 401 `INVALID_CREDENTIALS`, 403, 429, 502, 503.

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
El email de la sesión debe coincidir con el invitado (403 si no). 400 `INVALID_TOKEN` si ya se usó/caducó/revocó. Flujo para alguien sin cuenta: preview → registro con ese email → verificar → login → accept.

### GET `/api/orgs/{orgId}/audit` — owner
Query: `limit` (1–200), `cursor` (string numérica = `id` del último). Orden: más recientes primero.
```ts
200 { items: { id: string; event: string; user: { id: string; name: string | null } | null; ip: string | null; metadata: object; createdAt: string }[]; nextCursor: string | null }
```
Eventos (solo los asociados al local; los de cuenta como `auth.login` no aparecen aquí): `org.created`, `org.updated`, `org.exported`, `member.invited`, `member.role_changed`, `member.removed`, `member.joined`, `device.created`, `device.revoked`, `device.revoked_with_member`, `billing.subscription_canceled`, `staff.pin_changed`, `staff.pin_failed`, `staff.pin_locked`, `report.generated`, `billing.checkout_started`, `billing.subscription_updated`, `public_menu.updated`, `member.invitation_revoked`.

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

Validación: `minTemp ≤ maxTemp` (también al combinar con los valores actuales en PATCH) → 400 con `details[0].path = "minTemp"`. Sin borrado: desactivar con `active: false`.

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

`weekday` es obligatorio si `frequency = weekly`; `monthDay` si `monthly`. Los registros guardan una copia de los nombres de los ítems, así que editar un plan no altera registros pasados.

---

## 10. Registros — `/api/orgs/{orgId}/records`

Registros **inmutables** (append-only, reforzado con un trigger en la BD). No hay `PATCH`/`DELETE` (→ 404). Una corrección es una **enmienda**: un nuevo registro del mismo tipo que referencia al original, con motivo obligatorio. Solo una enmienda por registro; para volver a corregir, se enmienda la enmienda. En tareas, alertas y cumplimiento cuenta la versión vigente (la última de la cadena); los informes muestran ambas.

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
  createdAt: string;                                // hora del servidor
};
```

### Datos por tipo (entrada → almacenado)

**temperatura** — entrada `{ equipmentId: uuid; value: number (−60…300); correctiveAction?: string (≤1000) }`.
Si el valor queda fuera de `[minTemp, maxTemp]` del equipo, `correctiveAction` es obligatoria (400, `path: "data.correctiveAction"`). El equipo debe estar activo.
Almacenado: `{ equipmentId, equipmentName, value, minTemp, maxTemp, outOfRange: boolean, correctiveAction: string | null }`. `alert = outOfRange`.

**limpieza** — entrada `{ cleaningPlanId: uuid; items: { itemId: string; done: boolean }[]; observations?: string }`.
Los `itemId` deben pertenecer al plan, sin duplicados; los ítems no enviados cuentan como no hechos.
Almacenado: `{ cleaningPlanId, planName, items: { itemId, area, done }[], completed: boolean, observations }`. `alert = false`.

**recepcion** — entrada `{ supplierId?: uuid; supplierName?: string; product: string; lot?: string; temperature?: number; expiryDate?: "AAAA-MM-DD"; accepted: boolean; rejectionReason?: string }`.
Hace falta `supplierId` o `supplierName`; si `accepted = false`, `rejectionReason` es obligatorio. Con `supplierId`, el nombre se toma del proveedor.
Almacenado: `{ supplierId, supplierName, product, lot, temperature, expiryDate, accepted, rejectionReason }`. `alert = !accepted`.

**aceite** — entrada `{ equipmentId: uuid (de tipo 'freidora'); action: 'revisado' | 'cambiado'; polarCompounds?: number (0–100, %); correctiveAction?: string }`.
Si `polarCompounds > 25` (umbral de referencia `POLAR_COMPOUNDS_LIMIT`), `correctiveAction` es obligatoria.
Almacenado: `{ equipmentId, fryerName, action, polarCompounds, overLimit, correctiveAction }`. `alert = overLimit`.

**plagas** — entrada `{ result: 'sin_indicios' | 'con_indicios'; description?: string; action?: string }` (con indicios: `description` y `action` obligatorias).
Almacenado igual. `alert = result === 'con_indicios'`.

**incidencia** — entrada `{ description: string (1–2000); correctiveAction?: string; closed: boolean }`.
Almacenado igual. `alert = !closed`. Para **cerrar** una incidencia: crea una enmienda con `closed: true`.

**formacion** (formación de manipuladores) — entrada `{ traineeStaffId: uuid; course: string (1–300); trainingDate: "AAAA-MM-DD"; trainer?: string; hours?: number }`.
Almacenado: `{ traineeStaffId, traineeName, course, trainingDate, trainer, hours }`. `alert = false`.

En la entrada, los textos opcionales vacíos se guardan como `null`.

### GET `/records`
Query: `type?`, `from?` y `to?` (`AAAA-MM-DD`, fechas locales del local, inclusive), `equipmentId?`, `staffId?`, `alert?` (`true`/`false`), `limit`, `cursor`. → `200 Page<Record>` (más recientes primero).

### GET `/records/{recordId}`
`200 { record: Record; amends: Record | null; amendedBy: Record | null }`

### POST `/records` — escritura
Cuerpo: `{ type: RecordType; data: <entrada del tipo>; staffId?: uuid | null }` → `201 { record: Record }`.
`staffId` (opcional desde la web) indica qué miembro del personal firma; debe ser del local y estar activo. El usuario autenticado siempre queda registrado en `user`.
Errores: 400 `VALIDATION_ERROR` (paths con prefijo `data.`), 404 si `equipmentId`/`cleaningPlanId`/`supplierId`/`traineeStaffId`/`staffId` no son del local, 402 `READ_ONLY`, 429 (más de 120 altas por minuto del mismo usuario en el local).

### POST `/records/{recordId}/amendments` — escritura
Cuerpo: `{ reason: string (1–1000); data: <entrada COMPLETA del tipo del original>; staffId?: uuid | null }` → `201 { record: Record }` (con `amendsRecordId` y `amendmentReason`).
Errores: 400, 404, 409 `CONFLICT` si el registro ya tiene enmienda, 429 (comparte el límite de 120/min con las altas).

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
type Dish = { id: string; name: string; category: string | null; description: string | null; allergens: AllergenMap; visible: boolean; createdAt: string; updatedAt: string };
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
  allergens: { id: AllergenId; label: string }[];          // leyenda, en el orden oficial
  statuses: { contains: 'Contiene'; traces: 'Puede contener trazas'; no: 'No contiene' };
  dishes: { name: string; category: string | null; description: string | null; allergens: AllergenMap }[]; // solo visibles, por categoría y nombre
  updatedAt: string | null;
  notice: string;                                             // aviso para mostrar al cliente
}
```
404 si el slug no existe, la carta está desactivada **o el local está en solo lectura** (prueba caducada, impago, cancelada). Sin ids ni datos internos. Cabecera `X-Robots-Tag: noindex, nofollow`. Límite 120/min por IP.

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
    lastReading: { value: number; outOfRange: boolean; at: string } | null;
  }[];                       // equipos activos con checksPerDay > 0
  cleaning: {
    cleaningPlanId: string; name: string; frequency: 'daily' | 'weekly' | 'monthly';
    status: 'done' | 'pending';
    completedAt: string | null;
  }[];                       // planes activos que tocan hoy
  summary: { total: number; done: number; pending: number; percent: number };
  alerts: {
    kind: 'temperatura_fuera_de_rango' | 'aceite_fuera_de_limite' | 'recepcion_rechazada' | 'plagas_con_indicios' | 'incidencia_abierta';
    recordId: string; message: string; createdAt: string;
  }[];                       // alertas de hoy + incidencias abiertas de cualquier fecha (máx. 50 + 50)
}
```
Reglas: un plan semanal toca el `weekday` indicado; uno mensual, el `monthDay`. Se considera hecho si hay un registro de limpieza del plan desde el inicio de su periodo (lunes de la semana / día 1 del mes / hoy) hasta hoy. Las lecturas sustituidas por una enmienda no cuentan.

### GET `/tasks/compliance?from=AAAA-MM-DD&to=AAAA-MM-DD`
Rango máximo 92 días; los días futuros se omiten.
```ts
200 {
  from: string; to: string;
  days: { date: string; expected: number; done: number; percent: number | null }[]; // percent null si no había nada previsto
  overall: { expected: number; done: number; percent: number | null };
}
```
Usa la configuración actual (equipos/planes activos), contando cada uno desde su fecha de creación.

---

## 14. Informes — `/api/orgs/{orgId}/reports`

Query común: `from`, `to` (`AAAA-MM-DD`, inclusive, máx. 366 días) y `types` opcional (lista separada por comas de `RecordType`; vacío = todos). Disponibles para owner y manager, también en solo lectura. Quedan auditados.

### GET `/reports/pdf`
`200 application/pdf` con `Content-Disposition: attachment; filename="registros-{local}-{from}-a-{to}.pdf"`. A4 apaisado: cabecera con local, tipo, zona horaria, periodo y tipos; una tabla por tipo; filas fuera de rango en rojo; enmiendas destacadas con su motivo y referencia cruzada; pie con fecha de generación y número de página. **Máximo 5000 registros**: si el periodo/tipos superan esa cifra → 400 `REPORT_TOO_LARGE` (mensaje: acota fechas o tipos, o usa el CSV), antes de empezar a generar. Se genera en streaming. Límites: 10 / 10 min por local y por usuario; además, como mucho 2 PDF a la vez en el servidor: si están ocupados → 429 con `Retry-After` (reintenta pasados esos segundos).

### GET `/reports/csv`
`200 text/csv; charset=utf-8` (con BOM UTF-8, separador `;`, decimales con coma, todas las celdas entre comillas; pensado para Excel en español). Columnas: `id, tipo, fecha_hora, firmado_por_personal, firmado_por_usuario, dispositivo_cocina, alerta, enmienda_de, motivo_enmienda, corregido_por, equipo, valor_c, minimo_c, maximo_c, accion_correctora, plan_limpieza, items_realizados, items_no_realizados, observaciones, proveedor, producto, lote, temperatura_c, caducidad, resultado, motivo_rechazo, accion_aceite, compuestos_polares_pct, descripcion, accion, estado, persona_formada, curso, fecha_formacion, formador, horas`. Las celdas que empiezan por `= + - @` (salvo números) llevan el prefijo `'` para evitar inyección de fórmulas.

Límite CSV: 20 / 10 min por local y por usuario.

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
Errores: 403 (manager), 409 si ya existe una suscripción (usar el portal), 502 `BILLING_ERROR`, 503 `BILLING_NOT_CONFIGURED`.

### POST `/api/orgs/{orgId}/billing/portal` (owner)
Sin cuerpo → `200 { url: string }` (portal de cliente de Stripe: cambiar tarjeta, plan, cancelar, facturas). Vuelve a `{APP_URL}/locales/{orgId}/facturacion`.
Errores: 409 si no hay cliente de Stripe todavía, 502, 503.

### POST `/api/billing/webhook` (solo Stripe)
Firma `Stripe-Signature` verificada sobre el cuerpo crudo; idempotente por id de evento. Eventos usados: `checkout.session.completed`, `customer.subscription.created|updated|deleted`. Respuesta `200 { received: true, duplicate: boolean }`; 400 si la firma no es válida; 503 sin Stripe.

**Estados y solo lectura**: `active` y `trialing` permiten escribir. `trial_expired` (prueba local caducada), `past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired` y `paused` → solo lectura (402 `READ_ONLY` al escribir). Muestra un banner con un botón a Checkout (o al portal si `hasBillingAccount`).

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

### POST `/api/kiosk/records`
Cuerpo: `{ staffId: uuid; pin?: string; type: RecordType; data: <entrada del tipo> }` → `201 { record: Record }` (`user: null`, `deviceId` del dispositivo).
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
| GET · POST | `/api/kiosk/context`, `/api/kiosk/tasks/today` · `/api/kiosk/records` | Bearer de dispositivo |
| GET | `/api/public/menu/{slug}` | – |

"miembro" = owner o manager. Las rutas que crean o modifican datos exigen además que la suscripción permita escritura (§5).
