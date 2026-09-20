function normalize(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanEditorialTitle(value) {
  return normalize(value)
    .replace(/^[^A-Za-z0-9$]+/u, '')
    .replace(/^(?:Fresh StockMarketLoop coverage|New market read|Worth watching|Market update|On the radar)\s*:\s*/i, '')
    .replace(/\s*[-|]\s*Stock Market Loop\s*$/i, '')
    .replace(/\s*&\s*Here(?:'s| is) Why\s*$/i, '')
    .trim();
}

export function cleanEditorialSummary(value) {
  return normalize(value)
    .replace(/\[\s*Share Link\s*:\s*([^\]]+)\]/gi, '$1')
    .replace(/\bClick (?:the )?Blue Link Above to Read (?:the )?Full Article\b[.!]?/gi, '')
    .replace(/\bRead the full report and join the discussion\b[.!]?/gi, '')
    .replace(/\bRead the complete market report on StockMarketLoop for the full context\b[.!]?/gi, '')
    .replace(/\bOpen the article for the complete context\b[.!]?/gi, '')
    .replace(/(?:^|\s)#[A-Za-z0-9_]+\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}
