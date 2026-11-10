# Watch party (MVP web)

Salas privadas para ver el mismo contenido sincronizado y hablar por chat.
Máximo **5 personas** por sala (el mismo límite que los perfiles de onevid).

## Qué incluye

- Crear una sala desde el reproductor con el botón **Ver juntos**.
- Invitar con un link (`/watch/<roomId>`).
- Chat en tiempo real con Stream Chat.
- Sincronización de play / pause / seek / velocidad:
  - el host manda los eventos;
  - los invitados corrigen su posición con el heartbeat cada 5 s;
  - el estado se guarda en Postgres para quien entra tarde.
- Traspaso automático de host si el host sale.
- Cierre de sala por parte del host.
- Límite de 5 personas validado en el servidor.

## Retención del chat

La watch party es **efímera**: no se guarda historial.

- Al pulsar **Terminar** (host) se envía `watch_end`, se borra el canal de
  Stream (`hard_delete`, elimina mensajes y adjuntos) y se borra la sala de
  Postgres (miembros y estado caen en cascada).
- Al salir el **último miembro** se hace la misma limpieza.
- No hay cron ni retención programada: la sala y su chat se borran justo al
  terminar o cuando se va el último miembro.

El link de la fuente **no se guarda** en la sala ni en el chat: cada cliente
resuelve la suya con `/api/stream/sources`; solo se sincroniza la posición.

**No incluye todavía:** voz/video, móvil, TV, salas públicas, archivos locales
ni magnets. El video nunca pasa por Stream: cada cliente resuelve su propia
fuente con `/api/stream/sources`. La UI de la sala está en español por ahora.

## Requisitos

- Bun 1.4+
- Credenciales de Stream Chat (`STREAM_API_KEY`, `STREAM_API_SECRET`).
- La base Postgres compartida con hackw (`DATABASE_URL`).

## Desarrollo local

1. Instala dependencias:

   ```bash
   bun install
   ```

2. Añade las credenciales en `apps/web/.env.local`:

   ```dotenv
   STREAM_API_KEY=...
   STREAM_API_SECRET=...
   ```

   Son las mismas credenciales de la app de Stream de hackw; el cliente recibe
   la API key desde `/api/watch-rooms/[id]/join`, así que no hace falta una
   variable `NEXT_PUBLIC_`.

3. Aplica las tablas (idempotente):

   ```bash
   cd apps/web
   bun scripts/apply-watch-party-schema.ts
   ```

   El SQL está en `apps/web/drizzle/watch-party.sql`.

4. Levanta la web:

   ```bash
   bun dev
   ```

   Abre `http://localhost:3000`.

## Cómo probarlo

Necesitas **dos cuentas distintas**, no dos perfiles de la misma cuenta: Stream
identifica a cada participante por el id de usuario de Better Auth.

1. Entra con la cuenta A, abre una película o serie y pulsa **Ver juntos** en la
   barra superior del reproductor.
2. Copia el link de la sala desde el panel de chat.
3. Entra con la cuenta B en otro navegador/ventana privada y abre el link.
4. Comprueba:
   - aparecen los dos en **Personas** y el contador marca `2/5`;
   - los mensajes del chat llegan en ambos sentidos;
   - al dar play, pause o mover la barra como host, la cuenta B sigue la
     reproducción;
   - al salir el host, la cuenta B pasa a ser host;
   - al pulsar **Terminar** como host, la cuenta B ve “La sala terminó”.

### Probar el límite de 5

Abre la sala con 5 cuentas. La sexta recibe `409` y la pantalla “La sala está
llena”. El límite está en `WATCH_ROOM_MAX_PARTICIPANTS` y en la tabla
`watch_room.max_participants`.

## Deploy

El build que usa Cloudflare es vinext:

```bash
bun --filter web build:vinext
bun --filter web deploy:vinext
```

Antes del deploy, carga los secretos en Cloudflare:

```bash
# Ajusta el comando a tu flujo habitual de cf/wrangler.
# Los bindings ya están declarados en apps/web/cloudflare.config.ts.
```

Los bindings `STREAM_API_KEY` y `STREAM_API_SECRET` se declaran en
`apps/web/cloudflare.config.ts`.

## Notas de producción

- **Stream app compartida:** ahora se reutiliza la app de Stream de hackw. Eso
  suma los usuarios de onevid a su MAU y concurrentes. Si onevid crece, conviene
  separar la app para aislar límites y analítica.
- **MAU:** el Maker Account de Chat tiene 2.000 MAU y 100 concurrentes. Solo se
  conecta a Stream quien entra a una sala, así que el consumo depende de las
  salas activas, no de todo onevid.
- **Voz:** no implementada en este MVP. El diseño deja el canal listo para
  agregar Stream Video después; el video del título no debe pasar por WebRTC.
- **Derechos:** si el contenido viene de addons no licenciados, la watch party
  no cambia la licencia. Para producción, limita la función a contenido propio,
  licenciado o archivos del usuario.
- **Salas huérfanas:** si el host cierra la pestaña sin pulsar **Salir**, la sala
  queda abierta. Antes de abrirla al público conviene añadir un TTL o un
  “host inactivo”.
- **Móvil/TV:** pendiente. En TV la idea es usarla como pantalla y el teléfono
  como control/chat.

## Archivos principales

- `apps/web/src/app/watch/[roomId]/page.tsx` — página de la sala.
- `apps/web/src/components/watch/watch-room-client.tsx` — join + reproductor.
- `apps/web/src/components/watch/watch-party-overlay.tsx` — chat, personas y
  controles.
- `apps/web/src/components/watch/use-watch-party.ts` — sync + eventos.
- `apps/web/src/components/watch/watch-chat.ts` — conexión única a Stream Chat.
- `apps/web/src/app/api/watch-rooms/**` — crear, unirse, estado, salir, terminar.
- `apps/web/src/lib/watch-party.ts` — DB + Stream server.
- `apps/web/drizzle/watch-party.sql` — esquema aplicado.
