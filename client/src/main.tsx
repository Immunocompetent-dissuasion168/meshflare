import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/machines" replace />} />
        <Route path="/machines" element={<App />} />
        <Route path="/settings" element={<App />} />
        <Route path="*" element={<Navigate to="/machines" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
