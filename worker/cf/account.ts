import type { CloudflareClient } from "./client";

export type AccountInfo = {
  name: string;
  email: string | null;
};

/** Prefer account name for the product subtitle; include user email when available. */
export async function fetchAccountInfo(cf: CloudflareClient): Promise<AccountInfo> {
  const account = await cf.request<{ id: string; name: string }>(
    "GET",
    `/accounts/${cf.accountId}`,
  );
  let email: string | null = null;
  try {
    const user = await cf.request<{ email?: string }>("GET", "/user");
    email = user.result?.email?.trim() || null;
  } catch {
    /* token may lack User Read */
  }
  return {
    name: account.result?.name?.trim() || cf.accountId,
    email,
  };
}
