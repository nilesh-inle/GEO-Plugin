/**
 * Brand facts: the merchant's canonical statements about the store, published
 * to llms.txt and checked against tracked AI answers.
 */
import prisma from "../db.server";
import {
  MAX_FACTS,
  buildFactCheckRequest,
  cleanFact,
  normalizeFactCheck,
  suggestedFacts,
} from "../lib/brandFacts";
import { FIX_STATUS } from "../lib/constants";
import { getStore, patchStoreJson, toStoreView, updateStore } from "./store.server";
import { runWithAiTool } from "./tracking.server";

const CHECK_ANSWERS = 30;

export function listFacts(shop) {
  return prisma.brandFact.findMany({
    where: { shop },
    orderBy: [{ group: "asc" }, { createdAt: "asc" }],
  });
}

/** Marks llms.txt out of date so the next refresh includes the facts. */
async function markLlmsDirty(shop) {
  const store = await getStore(shop);
  if (store?.llmsStatus === FIX_STATUS.APPLIED)
    await updateStore(shop, { llmsDirty: true });
}

export async function saveFact(shop, input) {
  const { fact, error } = cleanFact(input);
  if (error) throw new Error(error);
  if (input.id) {
    const updated = await prisma.brandFact.updateMany({
      where: { shop, id: String(input.id) },
      data: fact,
    });
    if (!updated.count) throw new Error("That fact no longer exists.");
  } else {
    const count = await prisma.brandFact.count({ where: { shop } });
    if (count >= MAX_FACTS) throw new Error(`You can keep up to ${MAX_FACTS} facts.`);
    await prisma.brandFact.create({ data: { shop, ...fact } });
  }
  await markLlmsDirty(shop);
}

export async function deleteFact(shop, id) {
  await prisma.brandFact.deleteMany({ where: { shop, id: String(id) } });
  await markLlmsDirty(shop);
}

/** Adds the facts GEO can read from Shopify, skipping labels already used. */
export async function addSuggestedFacts(shop) {
  const store = toStoreView(await getStore(shop));
  const existing = await listFacts(shop);
  const used = new Set(existing.map((fact) => fact.label.toLowerCase()));
  const fresh = suggestedFacts(store)
    .filter((fact) => !used.has(fact.label.toLowerCase()))
    .slice(0, Math.max(0, MAX_FACTS - existing.length));
  if (fresh.length)
    await prisma.brandFact.createMany({
      data: fresh.map((fact) => ({ shop, ...fact })),
    });
  await markLlmsDirty(shop);
  return fresh.length;
}

/**
 * Asks a connected AI tool which facts the recent answers that name the
 * store agree with, contradict or leave out. Saved in settings.factCheck.
 */
export async function checkFacts(shop) {
  const [store, facts, answers] = await Promise.all([
    getStore(shop).then(toStoreView),
    listFacts(shop),
    prisma.trackAnswer.findMany({
      where: {
        shop,
        error: null,
        OR: [{ mentioned: true }, { cited: true }],
      },
      orderBy: { createdAt: "desc" },
      take: CHECK_ANSWERS,
      select: { text: true },
    }),
  ]);
  if (!facts.length) throw new Error("Add a few facts first.");
  if (!answers.length)
    throw new Error(
      "No tracked AI answers name your store yet. Run a check in AI visibility first.",
    );

  const { result, provider } = await runWithAiTool(
    shop,
    (adapter, tool) =>
      adapter.generateJson(
        tool.apiKey,
        tool.model,
        buildFactCheckRequest({ store, facts, answers }),
      ),
    { label: "Checking brand facts" },
  );
  const factCheck = {
    checkedAt: new Date().toISOString(),
    answers: answers.length,
    provider,
    results: normalizeFactCheck(result, facts),
  };
  await patchStoreJson(shop, "settings", { factCheck });
  return factCheck;
}
