const PRE_STYLE = {
  margin: 0,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "12px",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const LINE_STYLES = {
  removed: {
    color: "#8E1F0B",
    background: "#FEE9E8",
    textDecoration: "line-through",
  },
  added: { color: "#0C5132", background: "#CDFEE1" },
  note: { color: "#616161" },
};

/**
 * Monospace block. Pass `text` for plain content, or `lines` as
 * [{ text, kind: "removed" | "added" | "note" }] for a diff.
 */
export function CodeBlock({ text, lines, maxHeight }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <pre
        style={{
          ...PRE_STYLE,
          maxHeight,
          overflow: maxHeight ? "auto" : undefined,
        }}
      >
        {lines
          ? lines.map((line, index) => (
              <span
                key={index}
                style={{ display: "block", ...LINE_STYLES[line.kind] }}
              >
                {`${line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "}${line.text}`}
              </span>
            ))
          : text}
      </pre>
    </s-box>
  );
}
