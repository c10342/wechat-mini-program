export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function sendMessage(type, data) {
  self.postMessage({ type: type, data: data });
}

export function parseQuery(queryStr) {
  const query = {};
  if (!queryStr) return query;
  queryStr.split('&').forEach((pair) => {
    const parts = pair.split('=');
    const key = decodeURIComponent(parts[0]);
    const value = parts.length > 1 ? decodeURIComponent(parts[1]) : '';
    query[key] = value;
  });
  return query;
}
