import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { posthogServerCapture } from "@/lib/posthog-server";
import {
  normalizeQualityPref,
  type QualityPref,
  QUALITY_TIERS,
  type QualityTier,
} from "@/lib/stream-quality";

function buildOneVidId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Valida el cuerpo del PUT. Exige la lista COMPLETA de escalones y sin
 * repetidos: la preferencia es un orden, y un orden parcial dejaría a merced de
 * `normalizeQualityPref` dónde cae lo que falte — mejor que el cliente mande
 * siempre el estado entero que ve el usuario.
 */
function parseQualityPref(raw: unknown): QualityPref[] | null {
  if (!Array.isArray(raw) || raw.length !== QUALITY_TIERS.length) {
    return null;
  }
  const seen = new Set<QualityTier>();
  const pref: QualityPref[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const { tier, enabled } = entry as { enabled?: unknown; tier?: unknown };
    if (
      typeof tier !== "string" ||
      !QUALITY_TIERS.includes(tier as QualityTier) ||
      seen.has(tier as QualityTier) ||
      typeof enabled !== "boolean"
    ) {
      return null;
    }
    seen.add(tier as QualityTier);
    pref.push({ tier: tier as QualityTier, enabled });
  }
  return pref;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [row] = await db
    .select({ streamQualityOrder: oneVid.streamQualityOrder })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  return Response.json({
    configured: Array.isArray(row?.streamQualityOrder),
    order: normalizeQualityPref(row?.streamQualityOrder),
  });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { order?: unknown };
  try {
    body = (await request.json()) as { order?: unknown };
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const order = parseQualityPref(body.order);

  if (!order) {
    return Response.json(
      { error: "Formato de calidades inválido" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select({ id: oneVid.id })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const now = new Date();

  if (existing) {
    await db
      .update(oneVid)
      .set({ streamQualityOrder: order, updatedAt: now })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      streamQualityOrder: order,
      createdAt: now,
      updatedAt: now,
    });
  }

  posthogServerCapture({
    event: "onevid_quality_order_saved",
    distinctId: session.user.id,
    properties: {
      disabled_count: order.filter((entry) => !entry.enabled).length,
      top_tier: order.find((entry) => entry.enabled)?.tier ?? null,
    },
  }).catch(() => {
    /* ignore */
  });

  return Response.json({ ok: true, order });
}
