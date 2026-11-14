/**
 * seed.ts — Automated database seeder for Vrunda Infotech (VepariBook).
 *
 * Ensures the primary owner account (Contact@vrundainfotech.com),
 * organization tenant, and initial business exist in the database.
 * Safe to run on every deploy (idempotent).
 *
 * Usage:
 *   node packages/api/dist/bin/seed.js
 *   pnpm --filter @hisaabo/api seed
 */

import { config } from "dotenv";
if (process.env.NODE_ENV !== "production") {
  config({ path: "../../.env" });
}

import * as argon2 from "argon2";
import { nanoid } from "nanoid";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  controlDb,
  getTenantDb,
  users,
  tenants,
  tenantMembers,
  businesses,
  bankAccounts,
  closeControlClient,
  closeAllTenantPools,
} from "@hisaabo/db";

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "Contact@vrundainfotech.com").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Vrunda@1995";
  const adminName = process.env.ADMIN_NAME || "Vrunda Infotech";
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === "true";

  console.log(`[seed] Starting seed check for admin: ${adminEmail}`);

  // 1. Check or create default organization tenant
  let [defaultTenant] = await controlDb
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, "default"))
    .limit(1);

  if (!defaultTenant) {
    console.log("[seed] Creating default tenant organization...");
    [defaultTenant] = await controlDb
      .insert(tenants)
      .values({
        name: "Vrunda Infotech Organization",
        slug: "default",
        plan: "enterprise",
      })
      .returning({ id: tenants.id, name: tenants.name });
    console.log(`[seed] Tenant created with ID: ${defaultTenant.id}`);
  } else {
    // Ensure enterprise plan for unlimited businesses
    await controlDb
      .update(tenants)
      .set({ plan: "enterprise" })
      .where(eq(tenants.id, defaultTenant.id));
  }

  // 2. Check if admin user already exists
  const [existingUser] = await controlDb
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    console.log(`[seed] Admin user already exists with ID: ${userId}`);

    if (resetPassword) {
      console.log("[seed] Resetting admin password as requested...");
      const passwordHash = await argon2.hash(adminPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
      await controlDb
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
      console.log("[seed] Admin password updated successfully.");
    }
  } else {
    console.log("[seed] Creating primary admin user...");
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const [newUser] = await controlDb
      .insert(users)
      .values({
        email: adminEmail,
        name: adminName,
        passwordHash,
        emailVerified: true,
      })
      .returning({ id: users.id });

    userId = newUser.id;
    console.log(`[seed] Admin user created with ID: ${userId}`);
  }

  // 3. Ensure membership with role 'owner'
  const [existingMembership] = await controlDb
    .select({ id: tenantMembers.id, role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, defaultTenant.id),
        eq(tenantMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!existingMembership) {
    console.log("[seed] Assigning owner role in default tenant...");
    await controlDb.insert(tenantMembers).values({
      tenantId: defaultTenant.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });
    console.log("[seed] Owner membership assigned.");
  } else if (existingMembership.role !== "owner") {
    console.log("[seed] Upgrading role to owner...");
    await controlDb
      .update(tenantMembers)
      .set({ role: "owner" })
      .where(eq(tenantMembers.id, existingMembership.id));
    console.log("[seed] Role upgraded to owner.");
  }

  // 4. Ensure at least one initial business exists in tenant DB
  try {
    const tenantDb = await getTenantDb(defaultTenant.id);
    const existingBusinesses = await tenantDb
      .select({ id: businesses.id, name: businesses.name })
      .from(businesses)
      .limit(1);

    if (existingBusinesses.length === 0) {
      console.log("[seed] Provisioning default business for Vrunda Infotech...");
      const businessId = randomUUID();
      await tenantDb.insert(businesses).values({
        id: businessId,
        name: "Vrunda Infotech",
        legalName: "Vrunda Infotech",
        currency: "INR",
        createdByUserId: userId,
      });

      // Default cash account
      await tenantDb.insert(bankAccounts).values({
        businessId,
        accountName: "Cash",
        accountType: "cash",
        isDefault: true,
      });

      console.log(`[seed] Default business created with ID: ${businessId}`);
    } else {
      console.log(`[seed] Found ${existingBusinesses.length} existing business(es).`);
    }
  } catch (err) {
    console.warn("[seed] Notice: Could not access tenant DB for business creation:", err);
  }

  console.log("[seed] Seeding completed successfully.");
}

main()
  .then(async () => {
    await closeControlClient().catch(() => {});
    await closeAllTenantPools().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[seed] FATAL error during seeding:", err);
    await closeControlClient().catch(() => {});
    await closeAllTenantPools().catch(() => {});
    process.exit(1);
  });
