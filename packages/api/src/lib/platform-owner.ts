/**
 * platform-owner.ts — Identifies the platform Owner (Super Admin) of VepariBook.
 *
 * The platform owner (default: contact@vrundainfotech.com / ADMIN_EMAIL) has
 * overarching superadmin capabilities:
 * - Can access, view, and switch between ANY business across the system.
 * - Is the only role permitted to create new businesses.
 * Other roles (e.g. admin for a specific business) are scoped strictly to their
 * assigned business and cannot create new businesses.
 */

export function isPlatformOwner(user?: { email?: string | null; id?: string } | null): boolean {
  if (!user || !user.email) return false;
  const adminEmail = (process.env.ADMIN_EMAIL || "contact@vrundainfotech.com").trim().toLowerCase();
  const userEmail = user.email.trim().toLowerCase();
  return userEmail === adminEmail || userEmail === "contact@vrundainfotech.com";
}
