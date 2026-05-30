declare module "*.css";

declare module "lucide/dist/esm/createElement.mjs" {
  import type { IconNode, SVGProps } from "lucide";

  export default function createElement(iconNode: IconNode, customAttrs?: SVGProps): SVGElement;
}

declare module "lucide/dist/esm/icons/*.mjs" {
  import type { IconNode } from "lucide";

  const icon: IconNode;
  export default icon;
}
