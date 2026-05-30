import "./host.css";
import createElement from "lucide/dist/esm/createElement.mjs";
import Bug from "lucide/dist/esm/icons/bug.mjs";
import ChevronDown from "lucide/dist/esm/icons/chevron-down.mjs";
import Maximize2 from "lucide/dist/esm/icons/maximize-2.mjs";
import Minimize2 from "lucide/dist/esm/icons/minimize-2.mjs";
import Minus from "lucide/dist/esm/icons/minus.mjs";
import SquareTerminal from "lucide/dist/esm/icons/square-terminal.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

const titleLabel = document.querySelector<HTMLElement>("#title-label")!;
const debugMenu = document.querySelector<HTMLElement>("#debug-menu")!;
const debugMenuButton = document.querySelector<HTMLButtonElement>("#debug-menu-button")!;
const debugMenuPanel = document.querySelector<HTMLElement>("#debug-menu-panel")!;
const openDevtoolsButton = document.querySelector<HTMLButtonElement>("#open-devtools-button")!;
const openPageDevtoolsButton = document.querySelector<HTMLButtonElement>("#open-page-devtools-button")!;
const minimizeButton = document.querySelector<HTMLButtonElement>("#minimize-button")!;
const maximizeButton = document.querySelector<HTMLButtonElement>("#maximize-button")!;
const closeButton = document.querySelector<HTMLButtonElement>("#close-button")!;

type IconNode = Parameters<typeof createElement>[0];
let isDebugMenuOpen = false;

function createIcon(icon: IconNode, size = 16): SVGElement {
  return createElement(icon, {
    class: "window-icon",
    width: size,
    height: size,
    "stroke-width": 2.2,
    "aria-hidden": "true"
  });
}

function setIcon(button: HTMLButtonElement, icon: IconNode): void {
  const svg = createIcon(icon);
  button.replaceChildren(svg);
}

function setDebugMenuOpen(open: boolean): void {
  if (isDebugMenuOpen === open) return;
  isDebugMenuOpen = open;
  debugMenu.classList.toggle("is-open", open);
  debugMenuButton.setAttribute("aria-expanded", String(open));
  debugMenuPanel.hidden = !open;
  window.miniHost.windowControl?.(open ? "show-debug-menu" : "hide-debug-menu");
}

debugMenuButton.replaceChildren(createIcon(Bug), createIcon(ChevronDown, 14));
openDevtoolsButton.querySelector(".debug-menu-item-icon")?.replaceChildren(createIcon(SquareTerminal, 15));
openPageDevtoolsButton.querySelector(".debug-menu-item-icon")?.replaceChildren(createIcon(SquareTerminal, 15));
setIcon(minimizeButton, Minus);
setIcon(maximizeButton, Maximize2);
setIcon(closeButton, X);

window.miniHost.onStack?.((stack) => {
  const current = stack.at(-1);
  titleLabel.textContent = current ? current.title : "Mini Container";
});

window.miniHost.onHostConfig?.((config) => {
  const backgroundColor = config.navigationBarBackgroundColor || "#f6f3ea";
  document.documentElement.style.setProperty("--mini-nav-background", backgroundColor);
  document.documentElement.style.setProperty("--mini-app-background", config.backgroundColor || "#fffaf0");
  document.documentElement.dataset.navTextStyle = config.navigationBarTextStyle || "black";
});

debugMenuButton.addEventListener("click", () => {
  setDebugMenuOpen(debugMenuPanel.hasAttribute("hidden"));
});

openDevtoolsButton.addEventListener("click", () => {
  setDebugMenuOpen(false);
  window.miniHost.windowControl?.("open-devtools");
});

openPageDevtoolsButton.addEventListener("click", () => {
  setDebugMenuOpen(false);
  window.miniHost.windowControl?.("open-page-devtools");
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !debugMenu.contains(event.target)) setDebugMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setDebugMenuOpen(false);
});

minimizeButton.addEventListener("click", () => window.miniHost.windowControl?.("minimize"));
maximizeButton.addEventListener("click", () => window.miniHost.windowControl?.("toggle-maximize"));
closeButton.addEventListener("click", () => window.miniHost.windowControl?.("close"));

window.miniHost.onWindowState?.((state) => {
  maximizeButton.title = state.maximized ? "Restore" : "Maximize";
  maximizeButton.setAttribute("aria-label", maximizeButton.title);
  setIcon(maximizeButton, state.maximized ? Minimize2 : Maximize2);
});
