import { EditorView } from "sparql-editor";
import type { Extension } from "sparql-editor";
import { getPrefixRegistry } from "../lib/prefixRegistry";

// Trigger: line is exactly "PREFIX word:" with optional trailing whitespace — IRI not yet written
const PREFIX_READY_RE = /^PREFIX\s+(\w+):\s*$/i;

export function prefixCompletion(
  onAddPrefix?: (prefix: string, iri: string) => void
): Extension {
  // Pre-fetch registry so it's ready by first keystroke
  void getPrefixRegistry().catch(() => null);

  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    const state = update.state;
    const cursor = state.selection.main.head;
    const line = state.doc.lineAt(cursor);
    const match = PREFIX_READY_RE.exec(line.text);
    if (!match) return;

    const prefix = match[1];

    void (async () => {
      let registry: Record<string, string>;
      try {
        registry = await getPrefixRegistry();
      } catch {
        return;
      }

      const iri = registry[prefix.toLowerCase()];
      if (!iri) return;

      // Re-check the line is still in the same state before inserting
      const currentState = update.view.state;
      const currentLine = currentState.doc.lineAt(currentState.selection.main.head);
      if (currentLine.number !== line.number) return;
      if (!PREFIX_READY_RE.test(currentLine.text)) return;

      // Append after trimmed end: handles both "PREFIX org:" and "PREFIX org: "
      const trimmedLen = currentLine.text.trimEnd().length;
      const insertPos = currentLine.from + trimmedLen;
      const needsSpace = currentLine.text[trimmedLen - 1] === ":";
      const insertion = `${needsSpace ? " " : ""}<${iri}>`;

      update.view.dispatch({
        changes: { from: insertPos, to: currentLine.to, insert: insertion },
        selection: { anchor: insertPos + insertion.length }
      });

      onAddPrefix?.(prefix.toLowerCase(), iri);
    })();
  });
}
