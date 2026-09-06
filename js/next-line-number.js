export function getNextLineNumber(articles) {
  return (Array.isArray(articles) ? articles.length : 0) + 1;
}
