import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { resolveActiveProfile } from "@/lib/onevid-profile";
import { readProfileToken } from "@/lib/profile-token";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";

/**
 * Estadísticas del perfil activo para la tarjeta de Configuración → Cuenta.
 *
 * Días: sale de `onevid_profile_activity` (segundos vistos por día, escrita
 * desde el POST de progreso). Títulos: de `onevid_profile_progress`, que sí
 * guarda nombre y posición por película/episodio.
 *
 * Rachas: días consecutivos con al menos 1 minuto visto, contando hacia atrás
 * desde hoy (la actual) y la mayor del rango (la más larga).
 */
const MIN_DAY_SECONDS = 60;
const RANGE_DAYS = 365;

interface DayRow {
  day: string;
  seconds: number;
}

function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function computeStreaks(days: DayRow[]): {
  current: number;
  longest: number;
} {
  const watched = new Set(
    days
      .filter((row) => Number(row.seconds) >= MIN_DAY_SECONDS)
      .map((row) => toDateKey(row.day))
  );
  if (watched.size === 0) {
    return { current: 0, longest: 0 };
  }
  const sorted = [...watched].sort();
  let longest = 1;
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = new Date(`${sorted[index - 1]}T00:00:00Z`);
    const current = new Date(`${sorted[index]}T00:00:00Z`);
    const gapDays = Math.round(
      (current.getTime() - previous.getTime()) / 86_400_000
    );
    run = gapDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  // Racha actual: desde hoy hacia atrás (si hoy aún no cuenta, desde ayer).
  let current = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let index = 0; index < 400; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (watched.has(key)) {
      current += 1;
    } else if (index > 0) {
      break;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { current, longest };
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const limited = await checkRateLimitDb(
    `stats:${session.user.id}`,
    30,
    60_000
  );
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  const resolved = await resolveActiveProfile(
    session.user.id,
    request.headers.get("x-profile-id"),
    readProfileToken(request)
  );
  if (resolved.status === "no_profile") {
    return NextResponse.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
  }
  // Perfil con PIN sin verificar en esta sesión: se sirven SOLO los agregados
  // (minutos por día y rachas). Los títulos vistos se omiten, que es la parte
  // sensible. Así la tarjeta no pide el PIN si el usuario ya eligió su perfil.
  const titlesLocked = resolved.status === "pin_required";
  let profileId: string;
  if (resolved.status === "pin_required") {
    const [row] = await db
      .select({ id: oneVidProfile.id })
      .from(oneVidProfile)
      .where(
        and(
          eq(oneVidProfile.id, request.headers.get("x-profile-id") ?? ""),
          eq(oneVidProfile.userId, session.user.id)
        )
      )
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
    }
    profileId = row.id;
  } else {
    profileId = resolved.profile.id;
  }

  const daysResult = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, seconds
    FROM onevid_profile_activity
    WHERE profile_id = ${profileId}
      AND day >= CURRENT_DATE - ${`${RANGE_DAYS} days`}::interval
    ORDER BY day
  `);
  const dayRows =
    ((daysResult as unknown as { rows?: Record<string, unknown>[] } | null)
      ?.rows ?? []) as { day: string | Date; seconds: number | string }[];
  const rows: DayRow[] = dayRows.map((row) => ({
    day: toDateKey(row.day),
    seconds: Number(row.seconds) || 0,
  }));

  // Meses del año en curso vs. los mismos meses del año anterior, para que la
  // vista Mes compare en vez de solo mostrar barras sueltas.
  const monthResult = await db.execute(sql`
    SELECT
      extract(month from day)::int AS month,
      sum(
        CASE
          WHEN day >= date_trunc('year', CURRENT_DATE) THEN seconds
          ELSE 0
        END
      )::int AS current,
      sum(
        CASE
          WHEN day < date_trunc('year', CURRENT_DATE) THEN seconds
          ELSE 0
        END
      )::int AS previous
    FROM onevid_profile_activity
    WHERE profile_id = ${profileId}
      AND day >= date_trunc('year', CURRENT_DATE) - interval '1 year'
    GROUP BY 1
    ORDER BY 1
  `);
  const monthRows =
    ((monthResult as unknown as { rows?: unknown[] } | null)?.rows ??
      []) as { month: number; current: number; previous: number }[];
  const months: { month: number; current: number; previous: number }[] =
    Array.from({ length: 12 }, (_, index) => {
      const row = monthRows.find((item) => Number(item.month) === index + 1);
      return {
        month: index + 1,
        current: Number(row?.current) || 0,
        previous: Number(row?.previous) || 0,
      };
    });

  // Títulos agregados por MEDIA (no por episodio): una serie vista en varios
  // capítulos cuenta como una sola entrada, que es lo que espera el usuario.
  const topResult = titlesLocked
    ? null
    : await db.execute(sql`
        SELECT
          media_id AS "mediaId",
          media_type AS "mediaType",
          max(coalesce(name, media_id)) AS name,
          -- Tiempo visto por título: los episodios terminados cuentan su
          -- duración completa (no la última posición) y el que va a medias su
          -- posición. Así una serie se mide por lo que duró verla entera.
          sum(
            CASE
              WHEN finished THEN GREATEST(duration_sec, position_sec)
              ELSE position_sec
            END
          )::int AS "positionSec",
          count(*)::int AS episodes,
          max(poster) AS poster,
          max(background) AS background
        FROM onevid_profile_progress
        WHERE profile_id = ${profileId}
        GROUP BY media_id, media_type
        ORDER BY "positionSec" DESC
        LIMIT 5
      `);
  const top = ((topResult as unknown as { rows?: unknown[] } | null)?.rows ??
    []) as {
    mediaId: string;
    name: string;
    mediaType: string;
    positionSec: number;
    episodes: number;
    poster: string | null;
    background: string | null;
  }[];

  // Reparto películas/series sobre TODO el histórico del perfil.
  const typeResult = await db.execute(sql`
    SELECT media_type AS "mediaType",
      sum(
        CASE
          WHEN finished THEN GREATEST(duration_sec, position_sec)
          ELSE position_sec
        END
      )::int AS "positionSec"
    FROM onevid_profile_progress
    WHERE profile_id = ${profileId}
    GROUP BY media_type
  `);
  const typeRows =
    ((typeResult as unknown as { rows?: unknown[] } | null)?.rows ?? []) as {
      mediaType: string;
      positionSec: number;
    }[];
  const byType = typeRows.reduce(
    (acc, row) => {
      acc[row.mediaType === "series" ? "series" : "movie"] += Number(
        row.positionSec
      );
      return acc;
    },
    { movie: 0, series: 0 }
  );

  const totalSeconds = rows.reduce((total, row) => total + row.seconds, 0);
  const activeDays = rows.filter(
    (row) => row.seconds >= MIN_DAY_SECONDS
  ).length;
  const streaks = computeStreaks(rows);

  return NextResponse.json({
    days: rows,
    totals: {
      seconds: totalSeconds,
      activeDays,
    },
    streak: streaks,
    byType,
    titlesLocked,
    months,
    top,
  });
}
