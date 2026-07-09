import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "ID requerido" }, { status: 400 });
  }

  const result = await db
    .delete(oneVidAddon)
    .where(and(eq(oneVidAddon.id, id), eq(oneVidAddon.userId, session.user.id)))
    .returning({ id: oneVidAddon.id });

  if (result.length === 0) {
    return Response.json({ error: "No encontrado" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
