import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { patchStoreJson, updateStore } from "../services/store.server";
import { SettingsNav } from "../components/HubNav";
import { AUTOMATIONS, readAutomations } from "../lib/settings";

export const loader = async ({ request }) => {
  const { store } = await requireStore(request);
  return {
    automations: readAutomations(store.settings),
    llmsAutoUpdate: store.llmsAutoUpdate,
    indexNowReady: Boolean(store.settings.indexNowKey),
  };
};

export const action = async ({ request }) => {
  const { shop } = await requireStore(request);
  const body = await readBody(request);
  const patch = Object.fromEntries(
    AUTOMATIONS.map((item) => [item.key, body[item.key] === "true"]),
  );
  await patchStoreJson(shop, "settings", patch);
  await updateStore(shop, { llmsAutoUpdate: body.llmsAutoUpdate === "true" });
  return { ok: true };
};

export default function AutomationSettings() {
  const { automations, llmsAutoUpdate } = useLoaderData();
  const save = useFetcher();
  const formRef = useRef(null);

  const submit = () => {
    const values = {};
    for (const element of formRef.current?.querySelectorAll("s-switch[name]") ?? [])
      values[element.getAttribute("name")] = String(Boolean(element.checked));
    save.submit(values, { method: "post" });
  };

  return (
    <s-page heading="Settings">
      <SettingsNav current="automations" />
      <form
        data-save-bar
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
      <s-stack direction="block" gap="base" ref={formRef}>
        {save.data?.ok && <s-banner tone="success" heading="Automations saved" />}

        <s-section heading="Automations">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Automations keep data fresh. Changes to your store stay manual,
              except llms.txt, which only republishes what GEO already manages.
            </s-paragraph>
            {AUTOMATIONS.map((item) => (
              <s-switch
                key={item.key}
                name={item.key}
                label={item.label}
                details={item.detail}
                checked={automations[item.key] || undefined}
              />
            ))}
            <s-switch
              name="llmsAutoUpdate"
              label="Keep llms.txt updated"
              details="Republishes llms.txt when products or collections change, once GEO manages it."
              checked={llmsAutoUpdate || undefined}
            />
          </s-stack>
        </s-section>

        <s-section heading="Alerts">
          <s-paragraph>
            Critical issues, such as a blocked AI crawler, show as a banner on
            Overview and at the top of the Fix list.
          </s-paragraph>
        </s-section>
      </s-stack>
      </form>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
