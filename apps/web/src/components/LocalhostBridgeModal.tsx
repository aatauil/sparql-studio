import { useState } from "react";

interface LocalhostBridgeModalProps {
  onClose: () => void;
  onVerify: (extensionId: string) => Promise<boolean>;
  endpointUrl: string;
  savedExtensionId: string;
}

export function LocalhostBridgeModal({ onClose, onVerify, endpointUrl, savedExtensionId }: LocalhostBridgeModalProps) {
  const [extensionId, setExtensionId] = useState(savedExtensionId ?? "");
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  async function handleVerify() {
    setVerifyState("checking");
    const ok = await onVerify(extensionId);
    setVerifyState(ok ? "ok" : "fail");
  }

  return (
    <div
      className="fixed inset-0 bg-gray-900/45 grid place-items-center p-4 z-100"
      onClick={onClose}
    >
      <section
        className="w-full max-w-[520px] bg-white border border-gray-300 rounded-xl p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Enable localhost querying"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mt-0 mb-2 text-base font-semibold">Enable localhost querying</h2>

        <p className="text-sm text-gray-600 mb-3">
          Querying <code className="text-xs bg-gray-100 px-1 rounded">{endpointUrl}</code> requires
          the <strong>SPARQL Studio Bridge</strong> extension. Browsers block direct requests to
          localhost from web pages — the extension acts as a local proxy.
        </p>

        <ol className="text-sm text-gray-700 mb-4 pl-5 space-y-1.5 list-decimal">
          <li>Click <strong>Download bridge extension</strong> below and unzip the file.</li>
          <li>Open Chrome and go to <code className="text-xs bg-gray-100 px-1 rounded">chrome://extensions</code>.</li>
          <li>Enable <strong>Developer mode</strong> using the toggle in the top-right corner.</li>
          <li>Click <strong>Load unpacked</strong> and select the unzipped extension folder.</li>
          <li>Copy the extension ID shown under the extension name and paste it below.</li>
          <li>Click <strong>Verify connection</strong>.</li>
        </ol>

        <label className="block mb-3">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Extension ID</span>
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
          <a
            href="/bridge-extension.zip"
            download="bridge-extension.zip"
            className="btn"
          >
            Download bridge extension
          </a>

          <button
            className="btn"
            disabled={verifyState === "checking" || !(extensionId ?? "").trim()}
            onClick={() => void handleVerify()}
          >
            {verifyState === "checking" ? "Verifying…" : "Verify connection"}
          </button>

          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {verifyState === "ok" && (
          <p className="mt-3 text-sm text-green-600 font-medium">Connected! Extension ID saved — you can close this and run your query.</p>
        )}
        {verifyState === "fail" && (
          <p className="mt-3 text-sm text-red-600">Could not connect. Check the extension ID and make sure the extension is enabled.</p>
        )}
      </section>
    </div>
  );
}
