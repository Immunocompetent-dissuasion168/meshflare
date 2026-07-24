import type { CloudflareClient } from "./client";

export type AccountInfo = {
  name: string;
  email: string | null;
};

type AccountMember = {
  email?: string;
  status?: string;
  roles?: Array<{ name?: string }>;
  user?: { email?: string };
};

/**
 * Prefer account name for the product subtitle; include an email when available.
 * Account API tokens cannot call GET /user (9109), so we fall back to env and
 * account members.
 */
export async function fetchAccountInfo(
  cf: CloudflareClient,
  fallbackEmail?: string | null,
): Promise<AccountInfo> {
  const account = await cf.request<{ id: string; name: string }>(
    "GET",
    `/accounts/${cf.accountId}`,
  );

  let email: string | null = null;

  try {
    const user = await cf.request<{ email?: string }>("GET", "/user");
    email = user.result?.email?.trim() || null;
  } catch {
    /* account-scoped tokens lack user-level auth */
  }

  if (!email && fallbackEmail?.trim()) {
    email = fallbackEmail.trim();
  }

  if (!email) {
    try {
      const members = await cf.request<AccountMember[]>(
        "GET",
        cf.accountPath("/members?per_page=50&status=accepted"),
      );
      const list = members.result ?? [];
      const preferred =
        list.find((m) =>
          (m.roles ?? []).some((r) => /super administrator|administrator/i.test(r.name ?? "")),
        ) ?? list[0];
      email =
        preferred?.user?.email?.trim() ||
        preferred?.email?.trim() ||
        null;
    } catch {
      /* Account Settings Read may be missing */
    }
  }

  return {
    name: account.result?.name?.trim() || cf.accountId,
    email,
  };
}
