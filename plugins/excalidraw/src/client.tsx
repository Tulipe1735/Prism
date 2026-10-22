import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { transport } from "./bridge.ts";
import Canvas from "./editor.tsx";
import "./style.css";

function App(): React.JSX.Element {
  const [context, setContext] = useState<{
    sessionId: string | null;
    connected: boolean;
  }>({ sessionId: null, connected: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => transport.onContext(setContext), []);
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (
          event.name === "canvas.updated" &&
          event.sessionId === context.sessionId &&
          event.data !== null &&
          typeof event.data === "object" &&
          "revision" in event.data &&
          typeof event.data.revision === "number"
        )
          setRevision(event.data.revision);
      }),
    [context.sessionId],
  );
  return (
    <Canvas
      key={context.sessionId}
      sessionId={context.sessionId}
      connected={context.connected}
      revision={revision}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
window.addEventListener("pagehide", () => transport.close(), { once: true });
