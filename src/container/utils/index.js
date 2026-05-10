export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

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

export function evaluateCondition(condition, data) {
  let expr = condition.trim();
  if (expr.startsWith('{{') && expr.endsWith('}}')) {
    expr = expr.slice(2, -2).trim();
  }
  const compMatch = expr.match(/^(.+?)\s*(===|!==|>=|<=|>|<)\s*(.+)$/);
  if (compMatch) {
    const left = resolveExpr(compMatch[1].trim(), data);
    const op = compMatch[2];
    const rightRaw = compMatch[3].trim();
    let right;
    if (
      (rightRaw.startsWith('"') && rightRaw.endsWith('"')) ||
      (rightRaw.startsWith("'") && rightRaw.endsWith("'"))
    ) {
      right = rightRaw.slice(1, -1);
    } else if (rightRaw === 'true') {
      right = true;
    } else if (rightRaw === 'false') {
      right = false;
    } else if (rightRaw === 'null') {
      right = null;
    } else if (/^-?\d+(\.\d+)?$/.test(rightRaw)) {
      right = Number(rightRaw);
    } else {
      right = resolveExpr(rightRaw, data);
    }
    switch (op) {
      case '===': return left === right;
      case '!==': return left !== right;
      case '>=': return left >= right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '<': return left < right;
    }
  }
  const val = resolveExpr(expr, data);
  return !!val;
}

export function findMatchingCloseTag(tpl, tag, openStart) {
  let depth = 0;
  const openRegex = new RegExp('<' + tag.replace(/-/g, '\\-') + '(\\s[^>]*)?>', 'g');
  const closeRegex = new RegExp('<\\/' + tag.replace(/-/g, '\\-') + '>', 'g');
  openRegex.lastIndex = openStart;
  closeRegex.lastIndex = openStart;
  let openMatch, closeMatch;
  let lastClose = openStart;
  while (true) {
    openMatch = openRegex.exec(tpl);
    closeMatch = closeRegex.exec(tpl);
    if (!closeMatch) return -1;
    if (!openMatch || openMatch.index > closeMatch.index) {
      if (depth === 0) {
        return closeMatch.index;
      }
      depth--;
      lastClose = closeRegex.lastIndex;
    } else {
      depth++;
    }
  }
}
