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
│   │   ├── migrations/                      # 0001-0010, aplicadas en orden (ver abajo)
│   │   └── tests/                           # Suite pgTAP sobre la superficie de RLS
│   └── bruno/                               # Colección de tests HTTP y script de datos locales (ver Testing)
└── web/                                      # Dashboard React + Vite
    └── src/
        ├── App.tsx                          # Auth, selector de tenant, vistas de recursos/reservas
        ├── lib/                             # cliente supabase + wrapper de fetch al backend
        └── i18n/                            # react-i18next, es por defecto / en como toggle

.github/workflows/                       # ci.yml (pruebas en cada push), keep-alive.yml (ping al demo)
docs/                                    # notas de trade-offs y capturas
pake/                                    # íconos de la app (512 y 1024 px) para un build de escritorio de la web con Pake
```

Dos barreras independientes protegen el aislamiento entre tenants, y cuál aplica depende de la ruta que siga la petición:

- **A través de la API.** El backend habla con Postgres con la clave service-role, que salta RLS. En esta ruta el aislamiento depende de `TenantGuard`/`RolesGuard` más un filtro explícito por `tenant_id` en cada consulta de los servicios; RLS no aplica, así que un filtro omitido sería una fuga directa entre tenants.
- **Directo con el JWT de un usuario.** Un cliente que consulta por sí mismo la API PostgREST de Supabase queda sujeto a las políticas RLS de Postgres y a los privilegios de columna del rol `authenticated`. Esas son las barreras en esa ruta.

Algunas reglas las aplica Postgres a cualquier escritor, el service role incluido, así que valen en ambas rutas. Esto es lo que protege cada regla:

| Regla | A través de la API | Directo con el JWT de un usuario |
|---|---|---|
| Las filas de otros tenants no se pueden leer | `TenantGuard` + filtro por `tenant_id` en cada consulta | Políticas RLS de select |
| Roles por acción | `RolesGuard` | Políticas RLS de insert/update |
| Una reserva usa un recurso de su propio tenant | Foreign key compuesta `bookings_resource_same_tenant_fk`. La API responde 404, igual para un recurso de otro tenant y para uno que no existe | La misma foreign key (`23503`, también igual para un horario ocupado y uno libre) |
| Dos reservas confirmadas no se solapan en un recurso | Exclusion constraint `no_overlapping_bookings` (encabezado por `tenant_id`); 409 | El mismo constraint |
| Un owner solo puede cancelar una reserva | Solo existe `PATCH /bookings/:id/cancel`; cancela una reserva confirmada y nada más | `UPDATE` se concede solo sobre `bookings.status`, y la política del owner permite confirmada → cancelada; cancelada es terminal |

Ninguna barrera se asume redundante frente a la otra — ver "Testing" para cómo se verifica cada una por separado.

## Cómo empezar

Requiere Node 22 (la versión de `.node-version`). Monorepo con npm workspaces — un solo `npm install` en la raíz instala ambas apps.

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

Aplica las migraciones en orden contra tu proyecto de Supabase — `0001` crea el esquema y las políticas RLS, `0002` siembra dos tenants demo (sin filas en `auth.users`, esas vienen de registros reales), `0003` a `0007` agregan la creación por autoservicio de tenant/member/resource y el límite de tenants propios, `0008` agrega `public.ping()`, la función no-op detrás de `GET /v1/health` (ver la tabla de API abajo y `.github/workflows/keep-alive.yml`), `0009` hace que una reserva apunte a un recurso de su propio tenant (aborta si ya existen reservas que rompen esa regla) y `0010` limita lo que un owner puede cambiar de una reserva con el JWT de un usuario:

```bash
psql "<tu-connection-string-de-supabase>" \
  --single-transaction --variable ON_ERROR_STOP=1 \
  -f apps/api/supabase/migrations/0001_init.sql
# repetir para 0002 a 0010, en orden
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
| POST   | `/bookings`                | owner, staff              | Crea una reserva; 409 si hay overlap (exclusion constraint de Postgres), 404 si el recurso no es del tenant activo |
| PATCH  | `/bookings/:id/cancel`     | owner                     | Cancela una reserva confirmada; 404 si no está en el tenant activo, 409 si no está confirmada |
| GET    | `/health`                  | ninguno (sin autenticación) | Chequeo de vida para la automatización de keep-alive de Supabase; no toca ninguna tabla de negocio |

## Testing

Cuatro tipos de pruebas, cada una enfocada en algo concreto. Todas corren contra un stack local de Supabase, nunca contra el proyecto demo.

- **Jest** (`apps/api/src/**/*.spec.ts`) — pruebas unitarias sin base de datos. Cubren los guards, el filtro de excepciones y la intención de cada servicio: toda consulta acotada por tenant lleva el filtro de tenant, y el tenant de una escritura sale del contexto de la petición, nunca del payload. Muestran qué le pide el código a la base de datos, no que la base de datos rechace algo.
- **pgTAP** (`apps/api/supabase/tests/database/`) — pruebas a nivel SQL de lo que Postgres aplica por sí mismo. `001` cubre el aislamiento entre tenants mediante RLS. `002` cubre la regla de que una reserva usa un recurso de su propio tenant, con el JWT de un usuario y como service role, incluido que el rechazo es el mismo si el horario está ocupado o libre. `003` cubre qué puede cambiar un owner de una reserva con el JWT de un usuario.
- **Bruno** (`apps/api/bruno/`) — pruebas HTTP contra la API en ejecución y contra PostgREST, sin mocks:
  - **`setup/`** — inicia sesión directamente contra el password grant de Supabase Auth (no contra el backend, que no tiene su propio endpoint de login) y captura cada JWT en una variable de entorno automáticamente vía un post-response script.
  - **`security-tests/`** — `00`/`00b` prueban que `AuthGuard` rechaza un token faltante o inválido antes de que corra cualquier otra cosa; `01`/`02` prueban que `TenantGuard`/`RolesGuard` rechazan peticiones cross-tenant y de rol incorrecto; `03`/`04` son las que realmente importan para la afirmación central de este proyecto — evitan el backend de NestJS por completo y consultan la API PostgREST de Supabase directamente con el JWT de un usuario real, probando que RLS por sí sola filtra las filas cross-tenant (`200 []`) independientemente de cualquier guard de la capa de aplicación, con una petición de control del mismo tenant (`04`) confirmando que el resultado vacío significa aislamiento, no un endpoint roto; `05`/`05b` prueban que una reserva sobre un recurso de otro tenant y una sobre un recurso que no existe reciben el mismo 404.
  - **`booking-cancel/`** — el ciclo de cancelación a través de la API: una reserva confirmada se cancela, cancelarla otra vez es un 409, cancelar una reserva que no existe o una de otro tenant da el mismo 404, y un id mal formado da 400.
- **`tests/03-concurrent-overlap-race.sh`** — un shell script, no una petición de Bruno, porque probar que el exclusion constraint de no-overlap es race-safe requiere dos peticiones genuinamente simultáneas, algo que un cliente REST gráfico no puede garantizar; dos llamadas `curl` en background sí.

El workflow de CI (`.github/workflows/ci.yml`) corre Jest, pgTAP y Bruno en cada push y pull request. El script de carrera se corre a mano.

### Ejecutar las pruebas

Requisitos previos: Node 22 (ver `.node-version`), `npm install` en la raíz del repo, Docker y la [CLI de Supabase](https://supabase.com/docs/guides/local-development). El hook de preparación de pgTAP descarga sus helpers de prueba desde database.dev, así que las pruebas de base de datos requieren acceso a internet.

**Pruebas unitarias (Jest)** — no necesitan base de datos ni red:

```bash
npm test --workspace=apps/api
```

**Stack local de Supabase** — todas las pruebas de base de datos y HTTP de abajo corren contra él:

```bash
cd apps/api
# Levanta solo lo que necesitan las pruebas (base de datos, auth, REST y el
# gateway), con mucha menos memoria que un `supabase start` completo.
supabase start --exclude studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta
```

**Pruebas de base de datos (pgTAP)** — con el stack en ejecución, desde `apps/api`:

```bash
supabase test db
```

**Pruebas HTTP (Bruno)** — con el stack en ejecución, compila la API, arráncala contra el stack, crea los usuarios y datos de prueba y ejecuta la colección. Corre esto desde `apps/api`:

```bash
npm run build
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  PORT=3000 node dist/main &

# Crea usuarios y datos en el stack local y escribe
# bruno/environments/local-stack.bru, que Git ignora porque guarda las
# credenciales de prueba. Se puede repetir: cada corrida crea datos nuevos.
bash bruno/setup-local.sh

# CLI de Bruno: npm install --global @usebruno/cli
cd bruno
bru run setup security-tests booking-cancel --env local-stack
```

También puedes abrir `apps/api/bruno` en la app de Bruno, seleccionar el entorno `local-stack`, ejecutar `setup/` primero y luego las demás carpetas. Los entornos `local` y `localB` son plantillas vacías para un proyecto de Supabase propio.

**Carrera de solapamiento concurrente** — con la API en ejecución y el script de preparación ya corrido, desde `apps/api`:

```bash
bash bruno/tests/run-race.sh
```

Espera un `201` y un `409`, y elige un horario aleatorio, así que se puede repetir. Detén el stack con `supabase stop` cuando termines.

## Qué demuestra este proyecto

- Row Level Security como una segunda barrera genuina, no una formalidad: `FORCE ROW LEVEL SECURITY` en cada tabla (cierra el bypass del dueño de la tabla), el `auth.uid()` de cada política envuelto en una subquery para caching del planner, y aislamiento verificado independientemente de la capa de aplicación vía peticiones directas a PostgREST — no solo afirmado.
- Una garantía de no-overlap segura ante concurrencia vía un exclusion constraint de Postgres (`EXCLUDE USING gist`), probada bajo dos peticiones genuinamente simultáneas en vez de asumida a partir de locking a nivel de aplicación.
- Bootstrap multi-tenant por autoservicio (creación de tenant, invitaciones de member por email, creación de recursos restringida al owner) construido enteramente sobre funciones helper `SECURITY DEFINER` y políticas RLS — incluyendo un bug real detectado y corregido durante el desarrollo: una versión temprana de una función helper era invocable con un user id arbitrario, convirtiéndola en un oráculo de enumeración de metadata; corregido vinculándola al JWT del propio solicitante en vez de a un parámetro externo (ver migración `0007`). Trade-offs deliberados y documentados (un oráculo estrecho de existencia necesario para el bootstrap, y una race condition conocida del mismo usuario en el límite anti-abuso) se señalan explícitamente como decisiones de diseño aceptadas, no deuda silenciosa.
- Autorización de escritura basada en rol aplicada por acción (`owner` / `staff` / `viewer`), independiente de la validación de membresía al tenant, con ambos checks probados de forma independiente en la suite de tests.
- Localización completa de la UI en ES/EN (`react-i18next`), español por defecto con un toggle a inglés — una decisión deliberada que encaja con la audiencia inicial real de este proyecto, no un descuido. Los valores de rol (`owner` / `staff` / `viewer`) y el estado de la reserva (`confirmed` / `cancelled`) nunca se traducen: son datos de dominio persistidos/comparados, no copy de UI.

## Demo en vivo

**Frontend:** https://nestjs-rls-multitenant-bookings-web.vercel.app
**Backend:** https://nestjs-rls-multitenant-bookings-production.up.railway.app

Dos tenants sembrados (Aurora Studio, Riverside Clinic) con cuentas demo en los tres roles, así que el aislamiento cross-tenant y el acceso basado en rol son visibles sin necesidad de crear datos primero:

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

Apache License 2.0 — ver [LICENSE](./LICENSE) y [NOTICE](./NOTICE).
