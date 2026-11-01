// The one generic identity that every outgoing MCP, OAuth and API request carries in local privacy
// mode. It names no app, no version, no agent and no address, so a remote server learns nothing about
// the client. Every site that used to say "OpenBot" imports these, so a merge from upstream conflicts here only.

/** The `clientInfo.name` of an MCP `initialize` request. */
export const MCP_CLIENT_NAME = "mcp-client";
/** The `clientInfo.version`: fixed, never the app version. */
export const MCP_CLIENT_VERSION = "1.0.0";
/** The `User-Agent` of every request that needs one (GitHub refuses a request without it). */
export const MCP_CLIENT_USER_AGENT = "mcp-client";
/** The `client_name` of an OAuth dynamic client registration (RFC 7591). */
export const MCP_OAUTH_CLIENT_NAME = "MCP Client";
