import { findMatchingCloseTag, resolveExpr, evaluateCondition, convertWxmlTags } from '../utils/index.js';

export function processWxFor(tpl, data) {
  let output = tpl;
  while (true) {
    const wxForOpenRegex = /<(\w+[\w-]*)\s+([^>]*?)\s*wx:for="([^"]+)"([^>]*)>/;
    const match = wxForOpenRegex.exec(output);
    if (!match) break;
    
    const tag = match[1];
    const attrs = match[2];
    const listExpr = match[3];
    const rest = match[4];
    
    const openStart = match.index;
    const openEnd = openStart + match[0].length;
    const closePos = findMatchingCloseTag(output, tag, openEnd);
    if (closePos === -1) break;
    
    const content = output.substring(openEnd, closePos);
    const fullEnd = closePos + ('</' + tag + '>').length;
    
    let expr = listExpr.trim();
    if (expr.startsWith('{{') && expr.endsWith('}}')) {
      expr = expr.slice(2, -2).trim();
    }
    
    const list = resolveExpr(expr, data);
    if (!Array.isArray(list) || list.length === 0) {
      output = output.substring(0, openStart) + output.substring(fullEnd);
      continue;
    }
    
    const itemMatch = rest.match(/\s+wx:for-item="([^"]+)"/);
    const indexMatch = rest.match(/\s+wx:for-index="([^"]+)"/);
    const item = (itemMatch ? itemMatch[1] : null) || 'item';
    const index = (indexMatch ? indexMatch[1] : null) || 'index';
    
    const allAttrs = attrs + rest;
    const cleanedAttrs = allAttrs.replace(/\s*wx:for="[^"]+"/g, '')
                                 .replace(/\s*wx:for-item="[^"]+"/g, '')
                                 .replace(/\s*wx:for-index="[^"]+"/g, '')
                                 .replace(/\s*wx:if="[^"]+"/g, '')
                                 .replace(/\s*wx:elif="[^"]+"/g, '')
                                 .replace(/\s*wx:else\s*/g, '')
                                 .trim();
    
    let result = '';
    for (let i = 0; i < list.length; i++) {
      const itemData = Object.assign({}, data);
      itemData[item] = list[i];
      itemData[index] = i;
      const rendered = content.replace(/\{\{(.*?)\}\}/g, (m, e) => {
        const value = resolveExpr(e.trim(), itemData);
        return value != null ? String(value) : '';
      });
      result += '<' + tag + (cleanedAttrs ? ' ' + cleanedAttrs : '') + '>' + rendered + '</' + tag + '>';
    }
    
    output = output.substring(0, openStart) + result + output.substring(fullEnd);
  }
  
  return output;
}

export function processWxIf(tpl, data) {
  let output = tpl;
  let changed = true;
  while (changed) {
    changed = false;
    const ifOpenRegex = /<(\w+[\w-]*)([^>]*)\swx:if="([^"]*)"([^>]*)>/;
    const match = ifOpenRegex.exec(output);
    if (!match) break;

    const tag = match[1];
    const openStart = match.index;
    const openEnd = openStart + match[0].length;
    const closePos = findMatchingCloseTag(output, tag, openEnd);
    if (closePos === -1) break;
    const closeTagLen = ('</' + tag + '>').length;
    const content = output.substring(openEnd, closePos);
    const chainStart = openStart;
    let chainEnd = closePos + closeTagLen;

    const blocks = [];
    blocks.push({ condition: match[3], before: match[2], after: match[4], content: content });

    let remaining = output.substring(chainEnd);

    const elifOpenRegex = new RegExp(
      '^\\s*<' + tag.replace(/-/g, '\\-') + '([^>]*)\\s+wx:elif="([^"]*)"([^>]*)>'
    );
    while (true) {
      const elifMatch = remaining.match(elifOpenRegex);
      if (!elifMatch) break;
      const elifOpenEnd = remaining.indexOf('>', remaining.indexOf('wx:elif')) + 1;
      const elifOpenStartInRemaining = elifMatch.index;
      const elifContentStart = elifOpenStartInRemaining + elifOpenEnd;
      const elifClosePos = findMatchingCloseTag(remaining, tag, elifContentStart);
      if (elifClosePos === -1) break;
      const elifFullEnd = elifClosePos + closeTagLen;
      blocks.push({
        condition: elifMatch[2],
        before: elifMatch[1],
        after: elifMatch[3],
        content: remaining.substring(elifContentStart, elifClosePos),
      });
      chainEnd += elifFullEnd;
      remaining = output.substring(chainEnd);
    }

    const elseOpenRegex = new RegExp(
      '^\\s*<' + tag.replace(/-/g, '\\-') + '([^>]*)\\s+wx:else([^>]*)>'
    );
    const elseMatch = remaining.match(elseOpenRegex);
    if (elseMatch) {
      const elseOpenEnd = remaining.indexOf('>', remaining.indexOf('wx:else')) + 1;
      const elseOpenStartInRemaining = elseMatch.index;
      const elseContentStart = elseOpenStartInRemaining + elseOpenEnd;
      const elseClosePos = findMatchingCloseTag(remaining, tag, elseContentStart);
      if (elseClosePos !== -1) {
        blocks.push({
          condition: null,
          before: elseMatch[1],
          after: elseMatch[2],
          content: remaining.substring(elseContentStart, elseClosePos),
        });
        chainEnd += elseClosePos + closeTagLen;
      }
    }

    let result = '';
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.condition === null || evaluateCondition(block.condition, data)) {
        result = '<' + tag + block.before + block.after + '>' + block.content + '</' + tag + '>';
        break;
      }
    }

    output = output.substring(0, chainStart) + result + output.substring(chainEnd);
    changed = true;
  }
  return output;
}

export function processWxDirectives(tpl, data) {
  let output = tpl;
  output = processWxFor(output, data);
  output = processWxIf(output, data);
  return output;
}

export function renderTemplate(tpl, data) {
  if (!tpl || !data) return '';
  let output = tpl;
  output = processWxDirectives(output, data);
  output = output.replace(/\{\{(.*?)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), data);
    return value != null ? String(value) : '';
  });
  return convertWxmlTags(output);
}
