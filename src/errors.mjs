export const MAX_GRAPH_BYTES = 2 * 1024 * 1024;
export const MAX_HEADER_BYTES = 64 * 1024;

export class DiscoveryError extends Error {
  constructor(code, message, details = []) {
    super(message); this.name = 'DiscoveryError'; this.code = code; this.details = details;
  }
}
