import { app } from "electron";
import { join } from "node:path";
import { MiniProgramContainer } from "./container";

const ROOT = app.isPackaged ? process.resourcesPath : process.cwd();
const MINI_APP_ROOT = join(ROOT, "miniapps/demo1");

let container: MiniProgramContainer | null = null;

app.whenReady().then(async () => {
  container = new MiniProgramContainer({
    appRoot: MINI_APP_ROOT
  });
  await container.mount();
});

app.on("window-all-closed", () => {
  container?.destroy();
  container = null;
  if (process.platform !== "darwin") app.quit();
});

export { MiniProgramContainer };
export type { MiniProgramContainerOptions } from "./container";
