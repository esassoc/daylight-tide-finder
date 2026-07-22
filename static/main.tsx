import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

document.documentElement.style.setProperty("--font-geist-sans", '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif');
document.documentElement.style.setProperty("--font-geist-mono", '"JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace');

const root=document.getElementById("root");
if(!root)throw new Error("Static application root is missing.");
createRoot(root).render(<Home/>);
