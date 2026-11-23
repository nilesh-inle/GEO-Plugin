import prisma from "../db.server";
import { parseJson } from "../lib/format";

export function getStore(shop) {
  return prisma.store.findUnique({ where: { shop } });
}

export function upsertStore(shop, data) {
  return prisma.store.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

export function updateStore(shop, data) {
  return prisma.store.update({ where: { shop }, data });
}

/** Store row with JSON columns parsed, ready for loaders and generators. */
export function toStoreView(store) {
  if (!store) return null;
  return {
    ...store,
    policies: parseJson(store.policies, []),
    schemaSettings: parseJson(store.schemaSettings, null),
    fixState: parseJson(store.fixState, {}),
    shopFacts: parseJson(store.shopFacts, {}),
    accessState: parseJson(store.accessState, {}),
    settings: parseJson(store.settings, {}),
    competitors: parseJson(store.competitors, []),
  };
}

/** Merges one area's entry into Store.fixState. */
export async function updateFixState(shop, area, patch) {
  const store = await getStore(shop);
  const fixState = parseJson(store?.fixState, {});
  fixState[area] = { ...fixState[area], ...patch };
  return updateStore(shop, { fixState: JSON.stringify(fixState) });
}

/** Merges keys into one of the Store's JSON columns. */
export async function patchStoreJson(shop, column, patch) {
  const store = await getStore(shop);
  const value = { ...parseJson(store?.[column], {}), ...patch };
  return updateStore(shop, { [column]: JSON.stringify(value) });
}

/** Deletes everything stored for a shop (shop/redact). */
export async function deleteShopData(shop) {
  await prisma.$transaction([
    prisma.product.deleteMany({ where: { shop } }),
    prisma.collection.deleteMany({ where: { shop } }),
    prisma.audit.deleteMany({ where: { shop } }),
    prisma.syncRun.deleteMany({ where: { shop } }),
    prisma.trackAnswer.deleteMany({ where: { shop } }),
    prisma.citationWeek.deleteMany({ where: { shop } }),
    prisma.trackRun.deleteMany({ where: { shop } }),
    prisma.trackPrompt.deleteMany({ where: { shop } }),
    prisma.aiTool.deleteMany({ where: { shop } }),
    prisma.issueState.deleteMany({ where: { shop } }),
    prisma.changeLog.deleteMany({ where: { shop } }),
    prisma.brandFact.deleteMany({ where: { shop } }),
    prisma.productDraft.deleteMany({ where: { shop } }),
    prisma.store.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
