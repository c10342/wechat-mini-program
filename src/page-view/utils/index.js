export function convertWxssSelectors(css) {
  let output = css;
  output = output.replace(/(^|[\s{},>~+])view(?=[\s{},:>.~+\[]|$)/g, '$1div');
  output = output.replace(/(^|[\s{},>~+])text(?=[\s{},:>.~+\[]|$)/g, '$1span');
  output = output.replace(/(^|[\s{},>~+])image(?=[\s{},:>.~+\[]|$)/g, '$1img');
  return output;
}

export function convertWxmlTags(html) {
  let temp = html;
  temp = temp.replace(/<image([^>]*?)\/?\s*>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/src=["']([^"']+)["']/);
    const src = srcMatch ? srcMatch[1] : '';
    return `<img src="${src}" style="display:block;max-width:100%;" />`;
  });
  temp = temp.replace(/<view(\s[^>]*)?>/gi, '<div$1>');
  temp = temp.replace(/<\/view>/gi, '</div>');
  temp = temp.replace(/<text(\s[^>]*)?>/gi, '<span$1>');
  temp = temp.replace(/<\/text>/gi, '</span>');
  return temp;
}

export function resolveExpr(expr, data) {
  try {
    const keys = expr.trim().split('.');
    let value = data;
    for (let i = 0; i < keys.length; i++) {
      if (value == null) return null;
      value = value[keys[i]];
    }
    return value;
  } catch (e) {
    return null;
  }
}

export function renderTemplate(tpl, data) {
  if (!tpl || !data) return '';
  let output = tpl;
  output = output.replace(/<(\w+[\w-]*)([^>]*)\swx:if="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g, (match, tag, before, condition, after, content) => {
    let expr = condition.trim();
    if (expr.startsWith('{{') && expr.endsWith('}}')) {
      expr = expr.slice(2, -2).trim();
    }
    const val = resolveExpr(expr, data);
    if (val) {
      return '<' + tag + before + after + '>' + content + '</' + tag + '>';
    }
    return '';
  });
  output = output.replace(/\{\{(.*?)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), data);
    return value != null ? String(value) : '';
  });
  return convertWxmlTags(output);
}

export function parseAttrsString(attrs) {
  const result = {};
  if (!attrs) return result;
  const regex = /(\w[\w-]*)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = regex.exec(attrs)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

export function mergeAttrsToData(compData, attrs) {
  const parsed = parseAttrsString(attrs);
  const merged = {};
  for (const k in compData) {
    merged[k] = compData[k];
  }
  for (const k in parsed) {
    if (k.startsWith('bind:') || k === 'class' || k === 'data-comp-data') continue;
    merged[k] = parsed[k];
  }
  return merged;
}
