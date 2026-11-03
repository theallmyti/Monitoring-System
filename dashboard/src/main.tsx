import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./styles.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = ReactDOM.createRoot(document.getElementById("root")!);

if (!url) {
  // Without this check the Convex client throws on load and the page stays blank.
  root.render(
    <main className="center">
      <div className="card login">
        <h1>Dashboard not configured</h1>
        <p className="muted">Set VITE_CONVEX_URL in dashboard/.env.local and restart npm run dev.</p>
      </div>
    </main>,
  );
} else {
  const client = new ConvexReactClient(url);
  root.render(
    <React.StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </React.StrictMode>,
  );
}
