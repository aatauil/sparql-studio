import type { ReactNode } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./components/ui/resizable";

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
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize={initialTopSize} minSize={minTopSize}>
        {top}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={100 - initialTopSize} minSize={minBottomSize}>
        {bottom}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

