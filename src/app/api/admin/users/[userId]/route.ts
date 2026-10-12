import { z } from "zod";

import { forbidden } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { sessionContext } from "@/server/auth/request";

const bodySchema = z.object({ disabled: z.boolean() });

/** Disables or re-enables an account; disabling ends its sessions. Administrators only. */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  assertSameOrigin(request);
  const { access, auth } = await sessionContext(request);
  const admin = access.requireSession();
  if (!admin.isAdmin) throw forbidden("Only an administrator can manage accounts.");
  const { userId } = await params;
  const { disabled } = bodySchema.parse(await request.json());
  await auth.setDisabled(admin.id, userId, disabled);
  return json({ ok: true });
});
