import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface LocalhostBridgeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerify: (extensionId: string) => Promise<boolean>;
  endpointUrl: string;
  savedExtensionId: string;
}

export function LocalhostBridgeModal({ open, onOpenChange, onVerify, endpointUrl, savedExtensionId }: LocalhostBridgeModalProps) {
  const [extensionId, setExtensionId] = useState(savedExtensionId ?? "");
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  async function handleVerify() {
    setVerifyState("checking");
    try {
      const ok = await onVerify(extensionId);
      setVerifyState(ok ? "ok" : "fail");
    } catch {
      /* extension messaging threw — show failure, not a frozen UI */
      setVerifyState("fail");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Enable localhost querying</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Querying <code className="bg-muted px-1 rounded">{endpointUrl}</code> requires
          the <strong>SPARQL Studio Bridge</strong> extension. Browsers block direct requests to
          localhost from web pages — the extension acts as a local proxy.
        </p>

        <ol className="text-xs text-foreground pl-5 space-y-1.5 list-decimal">
          <li>Click <strong>Download bridge extension</strong> below and unzip the file.</li>
          <li>Open Chrome and go to <code className="bg-muted px-1 rounded">chrome://extensions</code>.</li>
          <li>Enable <strong>Developer mode</strong> using the toggle in the top-right corner.</li>
          <li>Click <strong>Load unpacked</strong> and select the unzipped extension folder.</li>
          <li>Copy the extension ID shown under the extension name and paste it below.</li>
          <li>Click <strong>Verify connection</strong>.</li>
        </ol>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extension ID</span>
          <input
            className="field-input mt-1"
            placeholder="e.g. abcdefghijklmnopabcdefghijklmnop"
            value={extensionId}
            onChange={(e) => { setExtensionId(e.target.value); setVerifyState("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleVerify(); }}
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" size="sm" asChild>
            <a href="/bridge-extension.zip" download="bridge-extension.zip">
              Download bridge extension
            </a>
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={verifyState === "checking" || !(extensionId ?? "").trim()}
            onClick={() => void handleVerify()}
          >
            {verifyState === "checking" ? "Verifying…" : "Verify connection"}
          </Button>

          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </div>

        {verifyState === "ok" && (
          <p className="text-xs text-green-600 font-medium">Connected! Extension ID saved — you can close this and run your query.</p>
        )}
        {verifyState === "fail" && (
          <p className="text-xs text-destructive">Could not connect. Check the extension ID and make sure the extension is enabled.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
