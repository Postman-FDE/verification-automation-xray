/**
 * Pure protocol selection logic for run.js (interactive and non-interactive).
 * Exported for unit testing.
 *
 * @typedef {{ key: string, summary: string }} Protocol
 */

/**
 * Parse interactive user input into selected protocol indices (0-based).
 * @param {string} selection - User input: "all" or comma-separated numbers (e.g. "1,3,5")
 * @param {Protocol[]} protocols - List of protocols (indices refer to this list)
 * @returns {number[]} Selected 0-based indices (may be empty)
 */
export function parseInteractiveSelection(selection, protocols) {
  if (selection.toLowerCase().trim() === 'all') {
    return [...protocols.keys()];
  }
  return selection
    .split(',')
    .map(s => parseInt(s.trim(), 10) - 1)
    .filter(i => !Number.isNaN(i) && i >= 0 && i < protocols.length);
}

/**
 * Resolve a test level from user input (interactive or non-interactive).
 * Accepts a 1-based number (e.g. "2") or a level name (case-insensitive, e.g. "vv").
 * Returns the canonical level string from testLevels, or null if invalid.
 * @param {string} input - Raw user input
 * @param {string[]} testLevels - Ordered list of valid level names (e.g. ['Dev', 'IV', 'VV'])
 * @returns {string|null} Canonical level name or null
 */
export function resolveTestLevel(input, testLevels) {
  const trimmed = input.trim();
  const byNumber = parseInt(trimmed, 10) - 1;
  if (!Number.isNaN(byNumber) && byNumber >= 0 && byNumber < testLevels.length) {
    return testLevels[byNumber];
  }
  return testLevels.find(l => l.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

/**
 * Resolve non-interactive protocol keys/numbers into 0-based indices.
 * Each input can be a Jira key (e.g. PF-502) or a 1-based list number (e.g. 1).
 * @param {string[]} protocolKeys - Comma-separated was already split; each item is key or number
 * @param {Protocol[]} protocols - List of protocols
 * @returns {number[]} Selected 0-based indices (unmatched inputs are omitted)
 */
export function resolveProtocolIndices(protocolKeys, protocols) {
  if (!protocolKeys || protocolKeys.length === 0) return [];
  return protocolKeys
    .map(input => {
      const trimmed = input.trim();
      const byKey = protocols.findIndex(p => p.key === trimmed.toUpperCase());
      if (byKey !== -1) return byKey;
      const byNumber = parseInt(trimmed, 10) - 1;
      if (!Number.isNaN(byNumber) && byNumber >= 0 && byNumber < protocols.length) return byNumber;
      return -1;
    })
    .filter(i => i !== -1);
}
