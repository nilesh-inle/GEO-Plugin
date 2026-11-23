import { useAppBridge } from "@shopify/app-bridge-react";
import { CodeBlock } from "./CodeBlock";

/**
 * Copy-and-paste fallback for when Shopify doesn't let the app write theme
 * files. Lists each template with a copy button and a link to the code editor.
 * @param {{ templates: { area: string, filename: string, content: string, editorUrl: string }[] }} props
 */
export function ManualTemplates({ templates }) {
  const shopify = useAppBridge();
  if (!templates?.length) return null;

  const copy = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
      shopify.toast.show("Copied");
    } catch {
      shopify.toast.show(
        "Couldn't copy. Select the text and copy it instead.",
        { isError: true },
      );
    }
  };

  return (
    <>
      <s-banner
        tone="warning"
        heading="One-time step for robots.txt and llms.txt"
      >
        Shopify only lets these files live in your theme. Add the{" "}
        {templates.length === 1 ? "template" : `${templates.length} templates`}{" "}
        once (about 2 minutes) and the app keeps the content updated after that.
        <s-button
          slot="secondary-actions"
          commandFor="geo-manual-templates"
          command="--show"
        >
          Add templates
        </s-button>
      </s-banner>

      <s-modal
        id="geo-manual-templates"
        heading="Add templates to your theme"
        size="large"
      >
        <s-stack direction="block" gap="base">
          <s-paragraph>
            For each file: open the code editor, choose{" "}
            <s-text type="strong">Add a new template</s-text>, pick the file
            type shown, then paste the content and save.
          </s-paragraph>
          {templates.map((template) => (
            <s-stack key={template.filename} direction="block" gap="small">
              <s-stack
                direction="inline"
                gap="small"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text type="strong">{template.filename}</s-text>
                <s-stack direction="inline" gap="small-200">
                  <s-button onClick={() => copy(template.content)}>
                    Copy content
                  </s-button>
                  <s-button href={template.editorUrl} target="_blank">
                    Open code editor
                  </s-button>
                </s-stack>
              </s-stack>
              <CodeBlock text={template.content} maxHeight="220px" />
            </s-stack>
          ))}
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="geo-manual-templates"
          command="--hide"
        >
          Done
        </s-button>
      </s-modal>
    </>
  );
}
