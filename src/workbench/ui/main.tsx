import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account.tsx";
import { App } from "./app.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountProvider>
      <App />
    </AccountProvider>
  </StrictMode>,
);
