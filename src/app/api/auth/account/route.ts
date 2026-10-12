import { z } from "zod";

import { assertSameOrigin, json, route } from "@/server/http";
import { sessionContext } from "@/server/auth/request";
import { toPublicUser } from "@/server/auth/service";

const bodySchema = z.object({
  name: z.string().max(200).optional(),
  currentPassword: z.string().max(1024).optional(),
  newPassword: z.string().max(1024).optional(),
});

/** Account settings: display name and password. Session only; a personal access token cannot change them. */
export const PATCH = route(async (request: Request) => {
  assertSameOrigin(request);
  const { access, auth } = await sessionContext(request);
  const user = access.requireSession();
  const body = bodySchema.parse(await request.json());
  if (body.name !== undefined) await auth.rename(user.id, body.name);
  if (body.newPassword !== undefined) await auth.changePassword(user, { current: body.currentPassword ?? "", next: body.newPassword }, access.principal.sessionHash);
  const fresh = await auth.store.findUserById(user.id);
  return json({ user: toPublicUser(fresh ?? user) });
});
