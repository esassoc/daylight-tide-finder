import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

// The app uses a single UI face (DM Sans); both legacy Geist vars map to it so the
// uppercase micro-labels render as DM Sans overlines rather than a blocky mono.
const uiFont = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
document.documentElement.style.setProperty("--font-geist-sans", uiFont);
document.documentElement.style.setProperty("--font-geist-mono", uiFont);

const root=document.getElementById("root");
if(!root)throw new Error("Static application root is missing.");
createRoot(root).render(<Home/>);
