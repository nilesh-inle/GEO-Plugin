const PURPOSE_SECTIONS = [
  { purposes: ["search", "user"], title: "AI search and assistants" },
  { purposes: ["training"], title: "Model training (your choice)" },
];

/** Crawler access grouped by purpose: search crawlers, then training crawlers. */
export function CrawlerTables({ crawlers }) {
  return PURPOSE_SECTIONS.map((section) => (
    <CrawlerTable
      key={section.title}
      title={section.title}
      crawlers={crawlers.filter((crawler) =>
        section.purposes.includes(crawler.purpose),
      )}
      training={section.purposes.includes("training")}
    />
  ));
}

function CrawlerTable({ title, crawlers, training }) {
  return (
    <s-stack direction="block" gap="small-200">
      <s-text type="strong">{title}</s-text>
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">AI crawler</s-table-header>
          <s-table-header>Used for</s-table-header>
          <s-table-header>Access</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {crawlers.map((crawler) => (
            <s-table-row key={crawler.agent}>
              <s-table-cell>{crawler.agent}</s-table-cell>
              <s-table-cell>{crawler.usedFor}</s-table-cell>
              <s-table-cell>
                {crawler.allowed ? (
                  <s-badge tone={training ? "neutral" : "success"}>
                    {training ? "Allowed, your choice" : "Allowed"}
                  </s-badge>
                ) : (
                  <s-badge tone={training ? "neutral" : "critical"}>
                    {training
                      ? "Blocked, your choice"
                      : `Blocked by ${crawler.rule}`}
                  </s-badge>
                )}
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}
