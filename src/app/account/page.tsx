import type { Metadata } from "next";

import { AccountSettings } from "@/features/auth/AccountSettings";

export const metadata: Metadata = { title: "Account" };

/** Static shell; the settings load for the signed-in person in the browser. */
export default function AccountPage() {
  return <AccountSettings />;
}
