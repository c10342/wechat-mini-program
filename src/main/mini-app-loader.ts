import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseScript } from "acorn";
import { parseDocument } from "htmlparser2";
import postcss, { Declaration } from "postcss";
import type { MiniAppBundle, MiniAppConfig, PageConfig } from "../shared/types";

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readOptional(filePath: string, fallback = ""): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function readRequired(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new Error(`Required mini program file is missing: ${filePath}`);
  }
}

function transformWxss(source: string): string {
  const root = postcss.parse(source);
  root.walkDecls((decl: Declaration) => {
    // 运行时维护 --rpx，让每个页面能按自己的 WebContents 宽度缩放。
    decl.value = decl.value.replace(/(-?\d*\.?\d+)rpx/g, "calc($1 * var(--rpx))");
  });
  return root.toString();
}

function validateWxml(source: string, route: string): void {
  parseDocument(source, { lowerCaseAttributeNames: false, lowerCaseTags: false });
  if (!source.trim()) {
    throw new Error(`Empty WXML template: ${route}`);
  }
}

function validateScript(source: string, filename: string): void {
  if (!source.trim()) return;
  parseScript(source, { ecmaVersion: "latest", sourceType: "script" });
}

export async function loadMiniApp(appRoot: string): Promise<MiniAppBundle> {
  const appConfig = await readJson<MiniAppConfig>(join(appRoot, "app.json"));
  const appScript = await readRequired(join(appRoot, "app.js"));
  validateScript(appScript, "app.js");
  const appWxss = transformWxss(await readOptional(join(appRoot, "app.wxss")));
  const pages: MiniAppBundle["pages"] = {};

  for (const route of appConfig.pages) {
    const pageRoot = join(appRoot, route);
    const config = await readJson<PageConfig>(`${pageRoot}.json`).catch(() => ({}));
    const wxml = await readOptional(`${pageRoot}.wxml`, "<view></view>");
    // App/page 脚本约定必须是 .js，和小程序作者侧的文件契约保持一致。
    const script = await readRequired(`${pageRoot}.js`);
    validateWxml(wxml, route);
    validateScript(script, `${route}.js`);
    const wxss = transformWxss(`${appWxss}\n${await readOptional(`${pageRoot}.wxss`)}`);
    pages[route] = {
      route,
      config,
      wxml,
      wxss,
      script
    };
  }

  return { appConfig, appScript, pages };
}
