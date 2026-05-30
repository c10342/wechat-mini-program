# Electron Mini Program

TypeScript mini program runtime for Electron. The UI layer uses multiple `WebContentsView` instances: one mini program page maps to one `webContents`. The logic layer runs in a dedicated Worker.

## Run Demo

```bash
npm start
```

The demo loads the `miniapps` directory in this project.

## Use As A Library

Create the container in the Electron main process after `app.whenReady()`.

```ts
import { app } from "electron";
import { join } from "node:path";
import { MiniProgramContainer } from "electron-mini-program";

let container: MiniProgramContainer | null = null;

app.whenReady().then(async () => {
  container = new MiniProgramContainer({
    appRoot: join(process.cwd(), "miniapps"),
    windowOptions: {
      width: 420,
      height: 820,
      title: "Mini Program"
    }
  });

  await container.mount();
});

app.on("window-all-closed", () => {
  container?.destroy();
  app.quit();
});
```

`rendererRoot` and `electronRoot` are not public options. The library resolves its fixed build layout internally:

- `dist/electron/preload/index.js`
- `dist/electron/worker/index.js`
- `dist/renderer/host.html`
- `dist/renderer/page.html`

## Public API

- `new MiniProgramContainer(options)`: creates a container instance and its `BrowserWindow`.
- `container.mount()`: loads the mini program, creates host/page views, starts the Worker, and opens the first page.
- `container.destroy()`: releases IPC handlers, Worker, and page `WebContentsView` instances.
- `container.navigateTo(url)`, `redirectTo(url)`, `reLaunch(url)`, `navigateBack(delta)`: host-side route controls.
- `container.window`: the `BrowserWindow` owned by the container.

`options.appRoot` points to a mini program root containing `app.json`, `app.js`, and page `.js/.wxml/.wxss/.json` files.
`app.json` must provide a unique `appId`; the runtime uses it as the singleton key and derives the IPC namespace from it.
