/**
 * Change history: every change GEO publishes to the store, with the snapshot
 * needed to put it back. Shown in Reports › Change history and on Overview.
 *
 * Snapshot kinds (ChangeLog.before):
 *   themeFile  { themeId, filename, content|null }  content null = file didn't exist
 *   schema     { status, settings }                 the schema embed config before
 *   product    { productId, fields }                product fields before the edit
 */
import prisma from "../db.server";
import { assertNoUserErrors, gql } from "./admin.server";
import { deleteThemeFile, writeThemeFile } from "./theme.server";
import { parseJson } from "../lib/format";

export const ACTOR = { MERCHANT: "You", AUTOMATIC: "Automatic" };
const KEEP = 200;

/** Records a published change. Never throws: history must not block a publish. */
export async function recordChange(
  shop,
  { area, title, detail = null, items = 1, actor = ACTOR.MERCHANT, before = null, status = "published" },
) {
  try {
    const row = await prisma.changeLog.create({
      data: {
        shop,
        area,
        title,
        detail,
        items,
        actor,
        status,
        before: before ? JSON.stringify(before) : null,
      },
    });
    const old = await prisma.changeLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      skip: KEEP,
      select: { id: true },
    });
    if (old.length)
      await prisma.changeLog.deleteMany({
        where: { id: { in: old.map((item) => item.id) } },
      });
    return row;
  } catch (error) {
    console.error(`[geo] recording change for ${shop} failed`, error);
    return null;
  }
}

function toView(row) {
  const before = parseJson(row.before, null);
  return {
    id: row.id,
    area: row.area,
    title: row.title,
    detail: row.detail,
    items: row.items,
    actor: row.actor,
    status: row.status,
    createdAt: row.createdAt,
    restoredAt: row.restoredAt,
    restorable: Boolean(before) && row.status === "published",
  };
}

export async function listChanges(shop, { take = 50, area } = {}) {
  const rows = await prisma.changeLog.findMany({
    where: { shop, ...(area ? { area } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toView);
}

async function restoreProduct(admin, before) {
  const { productId, fields } = before;
  const input = { id: productId };
  if (fields.title != null) input.title = fields.title;
  if (fields.descriptionHtml != null)
    input.descriptionHtml = fields.descriptionHtml;
  if (fields.seoTitle != null || fields.seoDescription != null)
    input.seo = {
      ...(fields.seoTitle != null ? { title: fields.seoTitle } : {}),
      ...(fields.seoDescription != null
        ? { description: fields.seoDescription }
        : {}),
    };
  const data = await gql(
    admin,
    `#graphql
    mutation GeoRestoreProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { product: input },
  );
  assertNoUserErrors(data.productUpdate, "Restoring the product");
}

/**
 * Puts back what a change replaced. Restores of theme files and products
 * write to the store; the change is then marked "restored".
 * @param {{ restoreSchema?: (admin, shop, before) => Promise<void> }} handlers
 *   injected to avoid a circular import with fixes.server.js
 */
export async function restoreChange(admin, shop, id, handlers = {}) {
  const row = await prisma.changeLog.findFirst({ where: { shop, id } });
  if (!row) throw new Error("That change no longer exists.");
  if (row.status !== "published")
    throw new Error("This change was already restored.");
  const before = parseJson(row.before, null);
  if (!before) throw new Error("This change can't be restored.");

  if (before.kind === "themeFile") {
    if (before.content == null)
      await deleteThemeFile(admin, before.themeId, before.filename);
    else
      await writeThemeFile(
        admin,
        before.themeId,
        before.filename,
        before.content,
      );
  } else if (before.kind === "schema") {
    if (!handlers.restoreSchema)
      throw new Error("Schema restore isn't available.");
    await handlers.restoreSchema(admin, shop, before);
  } else if (before.kind === "product") {
    await restoreProduct(admin, before);
  } else if (before.kind === "products") {
    for (const item of before.products) await restoreProduct(admin, item);
  } else {
    throw new Error("This change can't be restored.");
  }

  await prisma.changeLog.update({
    where: { id: row.id },
    data: { status: "restored", restoredAt: new Date() },
  });
  await recordChange(shop, {
    area: row.area,
    title: `Restored: ${row.title}`,
    items: row.items,
    status: "restored",
  });
  return toView({ ...row, status: "restored", restoredAt: new Date() });
}
