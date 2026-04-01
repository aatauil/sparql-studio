import type { ReactNode } from "react";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";

interface SplitLayoutProps {
  top: ReactNode;
  bottom: ReactNode;
  initialTopSize?: number;
  minTopSize?: number;
  minBottomSize?: number;
}

export function SplitLayout({
  top,
  bottom,
  initialTopSize = 55,
  minTopSize = 20,
  minBottomSize = 20
}: SplitLayoutProps) {
  return (
    <PanelGroup orientation="vertical" className="splitRoot">
      <Panel defaultSize={initialTopSize} minSize={minTopSize}>
        {top}
      </Panel>
      <Separator className="splitHandle" />
      <Panel minSize={minBottomSize}>
        {bottom}
      </Panel>
    </PanelGroup>
  );
}

