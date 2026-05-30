export function parseMiniUrl(input: string): { route: string; query: Record<string, string>; url: string } {
  const [pathPart, queryPart = ""] = input.replace(/^\//, "").split("?");
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { route: pathPart, query, url: input };
}

export function routeTitle(route: string, explicit?: string): string {
  return explicit || route.split("/").at(-1) || route;
}
