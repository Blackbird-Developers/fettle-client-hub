import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadGtm } from "./lib/gtm";
import { captureFunnelSessionFromUrl } from "./lib/booking/funnel";

loadGtm();
// Before routing: /packages?fs=… from the website may redirect to /login and drop the query.
captureFunnelSessionFromUrl();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
