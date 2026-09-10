# nestjs-rls-multitenant-bookings

🌐 [English](README.md) | [Español](README.es.md)

> **TL;DR:** Un sistema de reservas multi-tenant donde el aislamiento entre tenants está garantizado por el propio Postgres — Row Level Security, no solo lógica de aplicación — y verificado de forma independiente contra una base de datos real, no solo afirmado en este README.

![Vista de reservas — permite seleccionar un tenant activo, crear recursos con capacidades y gestionar nuevas reservas](docs/assets/bookings.png)

**Estado: desplegado.** El backend y el frontend están implementados, los tests de seguridad se ejecutaron de punta a punta contra una instancia real de Supabase (incluyendo una ronda de auditoría independiente sobre la capa de políticas RLS), y la app está en vivo con datos semilla — ver "Demo en vivo" abajo.

## Qué es esto

Un sistema de reservas multi-tenant donde el aislamiento entre tenants está garantizado a nivel de base de datos (Postgres Row Level Security), no solo en la lógica de la aplicación. El dominio de reservas es el ejemplo, no el punto central — el punto son las garantías de aislamiento: un usuario de un tenant no puede leer ni escribir datos de otro tenant, los roles se aplican por acción, y hacer double-booking de un recurso es imposible incluso bajo peticiones concurrentes, gracias a un exclusion constraint de Postgres en vez de locking a nivel de aplicación.

## Stack

- **API** (`apps/api`): NestJS + Fastify, Supabase (Postgres + Auth + RLS), TypeScript strict.
- **Web** (`apps/web`): React + Vite, Supabase Auth en el cliente, todo lo demás a través de la API.
- Monorepo con npm workspaces.

## Arquitectura

```
apps/
├── api/                                     # Backend NestJS
│   ├── src/
│   │   ├── tenants/                         # GET /tenants/me, POST /tenants (autoservicio)
│   │   ├── members/                         # POST /members (el owner invita staff/viewer por email)
│   │   ├── resources/                       # GET/POST /resources (creación restringida al owner)
│   │   ├── bookings/                        # POST/GET /bookings, PATCH /:id/cancel
│   │   ├── health/                          # GET /v1/health (objetivo del keep-alive de Supabase, sin guards)
│   │   └── common/
│   │       ├── guards/                      # AuthGuard, TenantGuard, RolesGuard
│   │       ├── decorators/roles.decorator.ts
│   │       ├── filters/all-exceptions.filter.ts   # Traduce códigos de error de Postgres a HTTP
│   │       └── supabase/supabase.client.ts  # Cliente service-role compartido
│   ├── supabase/
│   │   ├── migrations/                      # 0001-0008, aplicadas en orden (ver abajo)
│   │   └── tests/                           # Suite pgTAP sobre la superficie de RLS
│   └── bruno/                               # Colección de tests de seguridad (ver Testing)
└── web/                                      # Dashboard React + Vite
    └── src/
        ├── App.tsx                          # Auth, selector de tenant, vistas de recursos/reservas
        ├── lib/                             # cliente supabase + wrapper de fetch al backend
        └── i18n/                            # react-i18next, es por defecto / en como toggle
```

Dos barreras independientes protegen el aislamiento entre tenants, deliberadamente: `TenantGuard`/`RolesGuard` en la capa de NestJS (de lo que realmente depende la conexión service-role del backend), y las políticas RLS en Postgres (lo que protege los datos si alguna vez algo se conecta con el JWT de un usuario en vez de pasar por el backend). Ninguna se asume redundante frente a la otra — ver "Testing" para cómo se verifica cada una por separado.

## Cómo empezar

Requiere Node 22+ (ver `.node-version`). Monorepo con npm workspaces — un solo `npm install` en la raíz instala ambas apps.

```bash
npm install

# apps/api/.env  (copiar desde apps/api/.env.example)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000

# apps/web/.env  (copiar desde apps/web/.env.example)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_API_URL=http://localhost:3000/v1
```

Aplica las migraciones en orden contra tu proyecto de Supabase — `0001` crea el esquema y las políticas RLS, `0002` siembra dos tenants demo (sin filas en `auth.users`, esas vienen de registros reales), `0003` a `0007` agregan la creación por autoservicio de tenant/member/resource y el límite de tenants propios, y `0008` agrega `public.ping()`, la función no-op detrás de `GET /v1/health` (ver la tabla de API abajo y `.github/workflows/keep-alive.yml`):

```bash
psql "<tu-connection-string-de-supabase>" \
  --single-transaction --variable ON_ERROR_STOP=1 \
  -f apps/api/supabase/migrations/0001_init.sql
# repetir para 0002 a 0008, en orden
```

```bash
npm run dev:api    # NestJS en :3000
npm run dev:web    # Vite en :5173
```

## API

Todos los endpoints requieren `Authorization: Bearer <supabase-jwt>` y viven bajo `/v1`. Toda ruta más allá de `/tenants/me` y `/tenants` también requiere `x-tenant-id` — el tenant activo nunca se infiere, se valida contra las membresías reales del solicitante en cada petición.

| Método | Ruta                     | Guard                    | Descripción |
|--------|--------------------------|---------------------------|--------------|
| GET    | `/tenants/me`             | Solo JWT                  | Tenants a los que pertenece el solicitante, con su rol en cada uno |
| POST   | `/tenants`                 | Solo JWT                  | Crea un tenant; el solicitante se vuelve su owner automáticamente |
| POST   | `/members`                 | owner                     | Invita a un member staff/viewer por email |
| GET    | `/resources`               | cualquier member del tenant | Recursos activos del tenant activo |
| POST   | `/resources`               | owner                     | Crea un recurso para el tenant activo |
| GET    | `/bookings`                | cualquier member del tenant | Reservas del tenant activo, opcional `?resource_id=` |
| POST   | `/bookings`                | owner, staff              | Crea una reserva; 409 si hay overlap (exclusion constraint de Postgres) |
| PATCH  | `/bookings/:id/cancel`     | owner                     | Cancela una reserva confirmada |
| GET    | `/health`                  | ninguno (sin autenticación) | Chequeo de vida para la automatización de keep-alive de Supabase; no toca ninguna tabla de negocio |

## Testing

Una colección de [Bruno](https://www.usebruno.com/) vive en
`apps/api/bruno/`, corrida contra un proyecto Supabase real en vez de
mocks:

- **`setup/`** — inicia sesión directamente contra el password grant de Supabase Auth (no contra el backend, que no tiene su propio endpoint de login) y captura cada JWT en una variable de entorno automáticamente vía un post-response script.
- **`security-tests/`** — `00`/`00b` prueban que `AuthGuard` rechaza un token faltante o inválido antes de que corra cualquier otra cosa; `01`/`02` prueban que `TenantGuard`/`RolesGuard` rechazan peticiones cross-tenant y de rol incorrecto; `03`/`04` son las que realmente importan para la afirmación central de este proyecto — evitan el backend de NestJS por completo y consultan la API PostgREST de Supabase directamente con el JWT de un usuario real, probando que RLS por sí sola filtra las filas cross-tenant (`200 []`) independientemente de cualquier guard de la capa de aplicación, con una petición de control del mismo tenant (`04`) confirmando que el resultado vacío significa aislamiento, no un endpoint roto.
- **`tests/03-concurrent-overlap-race.sh`** — un shell script, no una petición de Bruno, porque probar que el exclusion constraint de no-overlap es race-safe requiere dos peticiones genuinamente simultáneas, algo que un cliente REST gráfico no puede garantizar; dos llamadas `curl` en background sí.

Una suite pgTAP separada (`apps/api/supabase/tests/`) ejercita la misma superficie de RLS a nivel SQL.

## Qué demuestra este proyecto

- Row Level Security como una segunda barrera genuina, no una formalidad: `FORCE ROW LEVEL SECURITY` en cada tabla (cierra el bypass del dueño de la tabla), el `auth.uid()` de cada política envuelto en una subquery para caching del planner, y aislamiento verificado independientemente de la capa de aplicación vía peticiones directas a PostgREST — no solo afirmado.
- Una garantía de no-overlap segura ante concurrencia vía un exclusion constraint de Postgres (`EXCLUDE USING gist`), probada bajo dos peticiones genuinamente simultáneas en vez de asumida a partir de locking a nivel de aplicación.
- Bootstrap multi-tenant por autoservicio (creación de tenant, invitaciones de member por email, creación de recursos restringida al owner) construido enteramente sobre funciones helper `SECURITY DEFINER` y políticas RLS — incluyendo un bug real detectado y corregido durante el desarrollo: una versión temprana de una función helper era invocable con un user id arbitrario, convirtiéndola en un oráculo de enumeración de metadata; corregido vinculándola al JWT del propio solicitante en vez de a un parámetro externo (ver migración `0007`). Trade-offs deliberados y documentados (un oráculo estrecho de existencia necesario para el bootstrap, y una race condition conocida del mismo usuario en el límite anti-abuso) se señalan explícitamente como decisiones de diseño aceptadas, no deuda silenciosa.
- Autorización de escritura basada en rol aplicada por acción (`owner` / `staff` / `viewer`), independiente de la validación de membresía al tenant, con ambos checks probados de forma independiente en la suite de tests.
- Localización completa de la UI en ES/EN (`react-i18next`), español por defecto con un toggle a inglés — una decisión deliberada que encaja con la audiencia inicial real de este proyecto, no un descuido. Los valores de rol (`owner` / `staff` / `viewer`) y el estado de la reserva (`confirmed` / `cancelled`) nunca se traducen: son datos de dominio persistidos/comparados, no copy de UI.

## Demo en vivo

**Frontend:** https://nestjs-rls-multitenant-bookings-web.vercel.app
**Backend:** https://nestjs-rls-multitenant-bookings-production.up.railway.app

Dos tenants sembrados (Aurora Studio, Willow Creek Clinic) con cuentas demo en los tres roles, así que el aislamiento cross-tenant y el acceso basado en rol son visibles sin necesidad de crear datos primero:

| Email | Password | Rol |
|---|---|---|
| `demo-owner@arkonysdevj.com` | `arkonys2026` | owner |
| `demo-staff@arkonysdevj.com` | `arkonys2026` | staff |
| `demo-viewer@arkonysdevj.com` | `arkonys2026` | viewer |

## Estado

- [x] Backend: módulos tenants/members/resources/bookings, guards, migraciones RLS, exclusion constraint de no-overlap.
- [x] Frontend: auth, selector de tenant, vistas de recursos + reservas, acciones restringidas por rol.
- [x] Tests de seguridad ejecutados contra una instancia real de Supabase (`apps/api/bruno`) — esta es la afirmación central del proyecto y ya está verificada de punta a punta: peticiones sin autenticación/con token inválido rechazadas, acceso cross-tenant rechazado tanto en la capa de aplicación COMO independientemente vía queries directas a PostgREST contra RLS (evitando el backend por completo), aplicación de rol rechazada para acciones no permitidas, y el exclusion constraint de no-overlap probado race-safe bajo dos peticiones genuinamente concurrentes.
- [x] Auditoría de seguridad independiente sobre la capa de políticas RLS (creación de tenant/member por autoservicio, recursos creados por el owner, límite de tenants propios) — un hallazgo corregido (un oráculo de enumeración en un helper `SECURITY DEFINER`, cerrado vinculándolo al JWT del propio solicitante en vez de a un parámetro externo), dos hallazgos aceptados como trade-offs deliberados y documentados, no bugs: un oráculo estrecho de existencia necesario para arrancar un tenant nuevo, y una race condition conocida en el límite de tenants propios bajo peticiones concurrentes del mismo usuario (no cruza límites de tenant — ver comentarios inline en la migración `0007` para ambos).
- [x] Datos semilla + deploy público — backend en Railway, frontend en Vercel, dos tenants sembrados, tres cuentas demo (owner/staff/viewer). Ver "Demo en vivo" arriba.
- [x] README completo con instrucciones de instalación.

✅ Desplegado — agosto 2026. Backend en Railway, frontend en Vercel.

## Licencia

MIT — ver [LICENSE](./LICENSE).
