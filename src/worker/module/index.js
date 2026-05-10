import { moduleCache, incrementRequestIdCounter } from '../state.js';
import { requestFile } from '../file/index.js';
import { sendMessage } from '../utils/index.js';

export function resolvePath(fromPath, requirePath) {
  if (requirePath.startsWith('/')) {
    return requirePath.slice(1);
  } else {
    const parts = fromPath.split('/');
    parts.pop();
    requirePath.split('/').forEach((seg) => {
      if (seg === '..') {
        parts.pop();
      } else if (seg !== '.') {
        parts.push(seg);
      }
    });
    const resolved = parts.join('/');
    if (!resolved.endsWith('.js')) {
      return resolved + '.js';
    }
    return resolved;
  }
}

export function createRequire(fromPath) {
  return function require(requirePath) {
    const resolvedPath = resolvePath(fromPath, requirePath);

    if (moduleCache[resolvedPath] !== undefined) {
      return moduleCache[resolvedPath].exports;
    }

    const mod = { exports: {}, loaded: false };
    moduleCache[resolvedPath] = mod;

    const requestId = incrementRequestIdCounter();

    sendMessage('readFile', { id: requestId, path: resolvedPath });

    throw new Error(
      '[Worker] require(\'' +
      requirePath +
      '\') from \'' +
      fromPath +
      '\') failed: ' +
      'synchronous require is not supported in async Worker. ' +
      'Use loadModuleAsync instead.'
    );
  };
}

export async function loadModuleAsync(modulePath) {
  if (moduleCache[modulePath] !== undefined) {
    return moduleCache[modulePath].exports;
  }

  const result = await requestFile(modulePath);
  if (!result.success) {
    console.error('[Worker] Failed to load module:', modulePath, result.error);
    return {};
  }

  const mod = { exports: {}, loaded: false };
  moduleCache[modulePath] = mod;

  const moduleExports = {};
  const moduleRef = { exports: moduleExports };
  const localRequire = createRequire(modulePath);

  try {
    const fn = new Function('require', 'module', 'exports', result.content);
    fn(localRequire, moduleRef, moduleExports);
    mod.exports = moduleRef.exports;
    mod.loaded = true;
  } catch (err) {
    console.error('[Worker] Module execution error (' + modulePath + '):', err);
    mod.exports = {};
  }

  return mod.exports;
}

export function executeScriptWithRequire(code, fromPath) {
  const moduleExports = {};
  const moduleRef = { exports: moduleExports };

  const pendingRequires = [];
  const syncRequire = function (path) {
    const resolved = resolvePath(fromPath, path);
    if (moduleCache[resolved] !== undefined) {
      return moduleCache[resolved].exports;
    }
    pendingRequires.push(resolved);
    return {};
  };

  try {
    const fn = new Function('require', 'module', 'exports', code);
    fn(syncRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error('[Worker] Script execution error:', err);
    return;
  }

  return pendingRequires;
}

export async function preloadModules(code, fromPath) {
  const requireRegex = /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  const modules = [];

  while ((match = requireRegex.exec(code)) !== null) {
    const resolved = resolvePath(fromPath, match[1]);
    modules.push(resolved);
  }

  for (let i = 0; i < modules.length; i++) {
    await loadModuleAsync(modules[i]);
  }
}

export function executeScript(code, fromPath) {
  const moduleExports = {};
  const moduleRef = { exports: moduleExports };
  const localRequire = createRequire(fromPath || '');

  try {
    const fn = new Function('require', 'module', 'exports', code);
    fn(localRequire, moduleRef, moduleExports);
  } catch (err) {
    console.error('[Worker] Script execution error:', err);
  }
}
