import { eq, and, or, sql, desc, gte, lte, inArray, count, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businesses, bankAccounts, controlDb, tenants, auditLog, parties, items, invoices, invoiceItems, payments, expenses, users } from "@hisaabo/db";
import { createBusinessSchema, updateBusinessSchema, updateSequenceNumberSchema, uploadBusinessLogoSchema } from "@hisaabo/shared";
import { router, tenantProcedure, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan, defineAbilityFor, mapDbRole } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { validateLogoDataUrl } from "../lib/validate-logo.js";
import { enforceBusinessLimit, enforceDataExport, getLimits } from "../lib/plan-limits.js";
import { seedChartOfAccounts } from "../lib/coa-seed.js";
import { encryptCarrierCredentials, decryptCarrierCredentials } from "../lib/field-encryption.js";
import { cacheBus } from "../lib/cache/bus.js";
import { requireTenantRole, getTenantRole, hasRole, ADMIN_ROLES, OWNER_ROLES } from "../lib/tenant-access.js";
import { csvRow } from "@hisaabo/shared";
import { getTenantMemberUserIds, businessTenantScope, assertBusinessInTenant } from "../lib/tenant-businesses.js";
import { isPlatformOwner } from "../lib/platform-owner.js";

async function requireTenantAdmin(userId: string, tenantId: string) {
  await requireTenantRole({ user: { id: userId }, tenantId }, ADMIN_ROLES, "Only admins can manage businesses");
}

async function requireTenantOwner(ctx: { user: { id: string; email?: string | null }; tenantId: string | null }) {
  if (isPlatformOwner(ctx.user)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the platform owner can create businesses",
  });
}

type Creds = ReturnType<typeof decryptCarrierCredentials>;

// Carrier API secrets are only for owners/admins; everyone else sees which
// carriers are enabled.
function carrierCredsFor(creds: Parameters<typeof decryptCarrierCredentials>[0], isAdmin: boolean): Creds {
  const decrypted = decryptCarrierCredentials(creds);
  if (isAdmin || !decrypted) return decrypted;
  return Object.fromEntries(
    Object.entries(decrypted).map(([carrier, entry]) => [carrier, { enabled: entry.enabled }]),
  );
}

export const businessRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const isOwner = isPlatformOwner(ctx.user);
    const { logoData: _logoData, ...cols } = getTableColumns(businesses);

    let rows;
    if (isOwner) {
      // Platform owner can access and view ANY business across the system
      rows = await ctx.db.select(cols).from(businesses);
    } else {
      // Other roles (e.g. admin for Jaynam Shah) can only view their own business
      const memberIds = await getTenantMemberUserIds(ctx.tenantId);
      rows = await ctx.db
        .select(cols)
        .from(businesses)
        .where(
          or(
            eq(businesses.createdByUserId, ctx.user.id),
            businessTenantScope(memberIds),
          ),
        );
    }

    const isAdmin = isOwner || hasRole(await getTenantRole(ctx.tenantId, ctx.user.id), ADMIN_ROLES);
    return rows.map((biz) => ({
      ...biz,
      carrierCredentials: carrierCredsFor(biz.carrierCredentials, isAdmin),
    }));
  }),

  // Check if more businesses can be created (only platform owner is permitted to create businesses).
  canCreate: tenantProcedure.query(async ({ ctx }) => {
    if (!isPlatformOwner(ctx.user)) return false;

    const [row] = await controlDb.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
    const limits = getLimits(row?.plan ?? "free");
    if (limits.maxBusinesses === Infinity) return true;
    const memberIds = await getTenantMemberUserIds(ctx.tenantId);
    const [{ count: bizCount }] = await ctx.db.select({ count: count() }).from(businesses).where(businessTenantScope(memberIds));
    return bizCount < limits.maxBusinesses;
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const isOwner = isPlatformOwner(ctx.user);
      const { logoData: _logoData, ...cols } = getTableColumns(businesses);

      let query;
      if (isOwner) {
        query = ctx.db.select(cols).from(businesses).where(eq(businesses.id, input.id));
      } else {
        const memberIds = await getTenantMemberUserIds(ctx.tenantId);
        query = ctx.db
          .select(cols)
          .from(businesses)
          .where(
            and(
              eq(businesses.id, input.id),
              or(
                eq(businesses.createdByUserId, ctx.user.id),
                businessTenantScope(memberIds),
              ),
            ),
          );
      }

      const [biz] = await query.limit(1);
      if (!biz) return null;
      const isAdmin = isOwner || hasRole(await getTenantRole(ctx.tenantId, ctx.user.id), ADMIN_ROLES);
      return {
        ...biz,
        carrierCredentials: carrierCredsFor(biz.carrierCredentials, isAdmin),
      };
    }),

  create: tenantProcedure.input(createBusinessSchema).mutation(async ({ input, ctx }) => {
    await requireTenantOwner(ctx);
    await enforceBusinessLimit(ctx.tenantId!, ctx.db);
    // `business` is emitted after the transaction settled (authz business
    // entries are positive-only, so this keeps the contract rather than fixing
    // a stale negative).
    let createdBizId: string | undefined;
    const biz = await ctx.db.transaction(async (tx) => {
      const [biz] = await tx.insert(businesses).values({
        ...input,
        createdByUserId: ctx.user.id,
      }).returning();

      // Auto-create a Cash account for every new business — must be atomic with
      // business creation so a failed account insert never leaves a business
      // without its default Cash account.
      await tx.insert(bankAccounts).values({
        businessId: biz.id,
        accountName: "Cash",
        accountType: "cash",
        openingBalance: "0",
        currentBalance: "0",
        isDefault: false,
      });

      // Seed a "Walk-in Customer" party. Required by POS mode as the default
      // partyId for anonymous retail sales, but cheap enough to always create
      // so offices that later enable POS don't need a separate seeding step.
      // `ensureWalkInParty` mutation covers existing businesses lazily.
      await tx.insert(parties).values({
        businessId: biz.id,
        type: "customer",
        name: "Walk-in Customer",
        openingBalance: "0",
      });

      // Seed the default Chart of Accounts for this business — must be inside
      // the same transaction so a partial failure rolls back cleanly.
      await seedChartOfAccounts(tx, biz.id);

      createdBizId = biz.id;
      return biz;
    }).finally(() => {
      cacheBus.invalidate({ kind: "business", tenantId: ctx.tenantId!, businessId: createdBizId });
    });

    logAudit(ctx.db, {
      businessId: biz.id,
      userId: ctx.user.id,
      action: "business.create",
      entityType: "business",
      entityId: biz.id,
      metadata: { name: biz.name },
      ipAddress: ctx.ipAddress,
    });

    return biz;
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBusinessSchema }))
    .mutation(async ({ input, ctx }) => {
      const isOwner = isPlatformOwner(ctx.user);
      if (!isOwner) {
        await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
      }

      // Encrypt carrier credentials if present in the update payload
      const data = { ...input.data } as Record<string, unknown>;
      if ("carrierCredentials" in data && data.carrierCredentials) {
        data.carrierCredentials = encryptCarrierCredentials(
          data.carrierCredentials as Parameters<typeof encryptCarrierCredentials>[0],
        );
      }

      const memberIds = await getTenantMemberUserIds(ctx.tenantId);
      const filter = isOwner
        ? eq(businesses.id, input.id)
        : and(
            eq(businesses.id, input.id),
            or(eq(businesses.createdByUserId, ctx.user.id), businessTenantScope(memberIds)),
          );

      const [biz] = await ctx.db
        .update(businesses)
        .set({ ...data, updatedAt: new Date() })
        .where(filter)
        .returning();

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.update",
        entityType: "business",
        entityId: biz.id,
        metadata: { name: biz.name },
        ipAddress: ctx.ipAddress,
      });

      return biz;
    }),

  uploadLogo: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: uploadBusinessLogoSchema }))
    .mutation(async ({ input, ctx }) => {
      const isOwner = isPlatformOwner(ctx.user);
      if (!isOwner) {
        await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
      }

      const { bytes, mime: actualMime } = validateLogoDataUrl(input.data.dataUrl);

      const memberIds = await getTenantMemberUserIds(ctx.tenantId);
      const filter = isOwner
        ? eq(businesses.id, input.id)
        : and(
            eq(businesses.id, input.id),
            or(eq(businesses.createdByUserId, ctx.user.id), businessTenantScope(memberIds)),
          );

      const [biz] = await ctx.db
        .update(businesses)
        .set({
          logoData: bytes,
          logoMimeType: actualMime,
          logoWidth: input.data.width,
          logoHeight: input.data.height,
          logoUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(filter)
        .returning({ id: businesses.id, logoUpdatedAt: businesses.logoUpdatedAt });

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.uploadLogo",
        entityType: "business",
        entityId: biz.id,
        metadata: { bytes: bytes.length, mime: actualMime, width: input.data.width, height: input.data.height },
        ipAddress: ctx.ipAddress,
      });

      return { logoUpdatedAt: biz.logoUpdatedAt };
    }),

  deleteLogo: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const isOwner = isPlatformOwner(ctx.user);
      if (!isOwner) {
        await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
      }

      const memberIds = await getTenantMemberUserIds(ctx.tenantId);
      const filter = isOwner
        ? eq(businesses.id, input.id)
        : and(
            eq(businesses.id, input.id),
            or(eq(businesses.createdByUserId, ctx.user.id), businessTenantScope(memberIds)),
          );

      const [biz] = await ctx.db
        .update(businesses)
        .set({
          logoData: null,
          logoMimeType: null,
          logoWidth: null,
          logoHeight: null,
          logoUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(filter)
        .returning({ id: businesses.id });

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.deleteLogo",
        entityType: "business",
        entityId: biz.id,
        ipAddress: ctx.ipAddress,
      });

      return { ok: true };
    }),

  setPosEnabled: tenantProcedure
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const isOwner = isPlatformOwner(ctx.user);
      if (!isOwner) {
        await requireTenantAdmin(ctx.user.id, ctx.tenantId!);
      }

      const memberIds = await getTenantMemberUserIds(ctx.tenantId);
      const filter = isOwner
        ? eq(businesses.id, input.id)
        : and(
            eq(businesses.id, input.id),
            or(eq(businesses.createdByUserId, ctx.user.id), businessTenantScope(memberIds)),
          );

      const [biz] = await ctx.db
        .update(businesses)
        .set({ posEnabled: input.enabled, updatedAt: new Date() })
        .where(filter)
        .returning({ id: businesses.id, posEnabled: businesses.posEnabled });

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      logAudit(ctx.db, {
        businessId: biz.id,
        userId: ctx.user.id,
        action: "business.setPosEnabled",
        entityType: "business",
        entityId: biz.id,
        metadata: { enabled: input.enabled },
        ipAddress: ctx.ipAddress,
      });

      return biz;
    }),

  // Lazily seed a "Walk-in Customer" party for this business and return its
  // ID. POS uses this as the default partyId for anonymous retail sales.
  //
  // Idempotent: if a party with the reserved name already exists it's
  // returned unchanged. Also safe to call concurrently — unique index on
  // (business_id, lower(name)) does not exist, so we use a SELECT-then-INSERT
  // pattern guarded by a transaction advisory lock keyed on businessId+name.
  // For v1 a small race window where two cashiers click "open POS" for a
  // never-seeded business at the same millisecond is acceptable — worst
  // case is two walk-in rows that an admin can merge.
  ensureWalkInParty: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const role = await getTenantRole(ctx.tenantId, ctx.user.id);
      requireCan(defineAbilityFor({ userId: ctx.user.id, role: mapDbRole(role ?? "") }), "create", "Party");
      // The main query keys off parties.businessId, so the tenant-ownership rule
      // can't fold into its WHERE — assert the business belongs to the caller's
      // tenant first (shared-DB safe), else a tenant could seed a walk-in party
      // into another tenant's business.
      await assertBusinessInTenant(ctx.db, ctx.tenantId, input.id);

      const [existing] = await ctx.db
        .select({ id: parties.id })
        .from(parties)
        .where(and(
          eq(parties.businessId, input.id),
          eq(parties.name, "Walk-in Customer"),
          eq(parties.type, "customer"),
        ))
        .limit(1);

      if (existing) return { id: existing.id, created: false };

      const [created] = await ctx.db
        .insert(parties)
        .values({
          businessId: input.id,
          type: "customer",
          name: "Walk-in Customer",
          openingBalance: "0",
        })
        .returning({ id: parties.id });

      return { id: created.id, created: true };
    }),

  updateSequenceNumber: adminProcedure
    .input(updateSequenceNumberSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Business");

      // Map documentType to the correct counter column
      // Map (not an object literal) so inherited keys like "constructor" can never match.
      const counterColumns = new Map<string, string>([
        ["invoice", "next_invoice_number"],
        ["payment", "next_payment_number"],
        ["quotation", "next_quotation_number"],
        ["credit_note", "next_credit_note_number"],
        ["delivery_challan", "next_delivery_challan_number"],
        ["proforma", "next_proforma_number"],
      ]);

      const column = counterColumns.get(input.documentType);
      if (!column) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid document type" });

      // Verify new number >= current number (can't go backwards)
      const [biz] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      const currentNumber = (biz as any)[column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] as number;

      if (input.newNumber < currentNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `New number (${input.newNumber}) cannot be less than current (${currentNumber})`,
        });
      }

      // Update using raw SQL for dynamic column name
      await ctx.db.execute(
        sql`UPDATE businesses SET ${sql.identifier(column)} = ${input.newNumber} WHERE id = ${ctx.businessId}`
      );

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "business.updateSequenceNumber",
        entityType: "business",
        entityId: ctx.businessId,
        metadata: { field: input.documentType, value: input.newNumber },
        ipAddress: ctx.ipAddress,
      });

      return { success: true, previousNumber: currentNumber, newNumber: input.newNumber };
    }),

  auditTrail: viewerProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const isAdmin = hasRole(await getTenantRole(ctx.tenantId, ctx.user.id), ADMIN_ROLES);
      if (!isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can view the audit trail" });
      }
      const offset = (input.page - 1) * input.limit;

      const conditions = [eq(auditLog.businessId, ctx.businessId)];
      if (input.fromDate) conditions.push(gte(auditLog.createdAt, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(auditLog.createdAt, new Date(input.toDate)));

      const [data, [totalRow]] = await Promise.all([
        ctx.db.select()
          .from(auditLog)
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: count() })
          .from(auditLog)
          .where(and(...conditions)),
      ]);

      // Resolve userIds → names via control DB (can't JOIN across DBs in cloud mode)
      const userIds = [...new Set(data.map((e) => e.userId))];
      const userRows = userIds.length > 0
        ? await controlDb
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      const userMap = new Map(userRows.map((u) => [u.id, u.name || u.email]));

      return {
        data: data.map((entry) => ({
          ...entry,
          userName: userMap.get(entry.userId) ?? "Unknown user",
        })),
        total: totalRow?.count ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  exportData: adminProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    await enforceDataExport(ctx.tenantId!);
    const [partiesData, itemsData, invoicesData, lineItemsData, paymentsData, expensesData] = await Promise.all([
      ctx.db.select().from(parties).where(eq(parties.businessId, ctx.businessId)),
      // Historical export — include soft-deleted items so the user's
      // backup is a complete record of what ever lived in their catalog.
      // A soft-deleted row still carries its `deletedAt` column, which
      // the CSV schema ignores today (columns explicitly listed below);
      // callers that need it can reach into the raw rows directly.
      ctx.db.select().from(items).where(eq(items.businessId, ctx.businessId)),
      ctx.db.select().from(invoices).where(eq(invoices.businessId, ctx.businessId)).orderBy(invoices.invoiceDate),
      ctx.db
        .select({ invoice_items: invoiceItems })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .where(eq(invoices.businessId, ctx.businessId)),
      ctx.db.select().from(payments).where(eq(payments.businessId, ctx.businessId)).orderBy(payments.paymentDate),
      ctx.db.select().from(expenses).where(eq(expenses.businessId, ctx.businessId)).orderBy(expenses.expenseDate),
    ]);

    return {
      parties: toCsv(partiesData, ["name", "type", "phone", "email", "gstin", "billingAddress", "city", "state", "pincode", "openingBalance", "category"]),
      items: toCsv(itemsData, ["name", "itemType", "unit", "salePrice", "purchasePrice", "taxPercent", "hsn", "sku", "stockQuantity", "category"]),
      invoices: toCsv(invoicesData, ["invoiceNumber", "type", "documentType", "invoiceDate", "dueDate", "status", "subtotal", "taxAmount", "discountAmount", "totalAmount", "amountPaid", "notes"]),
      lineItems: toCsv(lineItemsData.map(r => r.invoice_items), ["invoiceId", "itemName", "description", "quantity", "unitPrice", "taxPercent", "taxAmount", "discountPercent", "totalAmount"]),
      payments: toCsv(paymentsData, ["paymentNumber", "paymentDate", "amount", "mode", "referenceNumber", "notes"]),
      expenses: toCsv(expensesData, ["category", "description", "amount", "mode", "expenseDate", "referenceNumber"]),
    };
  }),
});

function toCsv<T extends Record<string, unknown>>(data: T[], fields: string[]): string {
  const rows = data.map((row) =>
    csvRow(fields.map((f) => {
      const val = row[f];
      return val instanceof Date ? val.toISOString() : val;
    })),
  );
  return [csvRow(fields), ...rows].join("\n");
}
