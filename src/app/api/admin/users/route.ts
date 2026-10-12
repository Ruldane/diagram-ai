import { z } from "zod";

import { forbidden } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { sessionContext } from "@/server/auth/request";
import { toPublicUser } from "@/server/auth/service";

const bodySchema = z.object({ email: z.string().max(254), name: z.string().max(200), password: z.string().max(1024) });

async function adminContext(request: Request) {
  const context = await sessionContext(request);
  const user = context.access.requireSession();
  if (!user.isAdmin) throw forbidden("Only an administrator can manage accounts.");
  return { ...context, user };
}

/** Everyone with an account. Administrators only. */
export const GET = route(async (request: Request) => {
  const { auth } = await adminContext(request);
  return json({ users: await auth.users() }, { headers: { "Cache-Control": "no-store" } });
});

/** Creates an account without an invitation (the way in when sign-up is closed). Administrators only. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const { auth } = await adminContext(request);
  const user = await auth.createUserAsAdmin(bodySchema.parse(await request.json()));
  return json({ user: toPublicUser(user) }, { status: 201 });
});
