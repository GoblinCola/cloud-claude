/**
 * MCP HTTP Client Helper
 *
 * Manages the Streamable HTTP lifecycle for calling the remote PIA MCP server:
 *   initialize → call tool(s) → (optional) close session
 *
 * Reads API key from ~/.claude/pia-mcp-key
 * Caches session ID for reuse within a single hook execution.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const MCP_URL = process.env.PIA_MCP_URL || 'https://pia.goblincola.com/mcp';
const KEY_FILE = resolve(homedir(), '.claude', 'pia-mcp-key');

let cachedApiKey = null;
let sessionId = null;

/**
 * Read the API key from disk (cached after first read)
 */
function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  try {
    cachedApiKey = readFileSync(KEY_FILE, 'utf-8').trim();
    return cachedApiKey;
  } catch {
    return null;
  }
}

/**
 * Send a JSON-RPC request to the MCP server
 */
async function rpc(method, params, id) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key found at ~/.claude/pia-mcp-key');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${apiKey}`,
  };

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const body = {
    jsonrpc: '2.0',
    method,
    params: params || {},
    id: id || 1,
  };

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP HTTP ${res.status}: ${text}`);
  }

  // Capture session ID from response
  const respSessionId = res.headers.get('mcp-session-id');
  if (respSessionId) {
    sessionId = respSessionId;
  }

  const contentType = res.headers.get('content-type') || '';

  // Handle SSE response (Streamable HTTP can return SSE for initialize)
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    // Parse SSE: look for "data: " lines containing JSON
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // Skip non-JSON data lines
        }
      }
    }
    throw new Error('No valid JSON-RPC response in SSE stream');
  }

  return res.json();
}

/**
 * Initialize a session with the MCP server
 */
async function initialize() {
  const result = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'claude-hooks', version: '1.0.0' },
  }, 0);
  return result;
}

/**
 * Call an MCP tool
 *
 * @param {string} toolName - Name of the tool to call
 * @param {object} args - Tool arguments
 * @returns {object} Parsed tool result
 */
export async function callTool(toolName, args) {
  // Initialize session if needed
  if (!sessionId) {
    await initialize();
  }

  const response = await rpc('tools/call', {
    name: toolName,
    arguments: args || {},
  }, 2);

  // Extract result from MCP response envelope
  if (response.result) {
    const content = response.result.content;
    if (Array.isArray(content) && content.length > 0 && content[0].text) {
      try {
        return JSON.parse(content[0].text);
      } catch {
        return content[0].text;
      }
    }
    return response.result;
  }

  if (response.error) {
    throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
  }

  return response;
}

/**
 * Call multiple tools sequentially within the same session
 */
export async function callTools(calls) {
  const results = [];
  for (const { tool, args } of calls) {
    results.push(await callTool(tool, args));
  }
  return results;
}

/**
 * Check if the MCP server is reachable
 */
export async function healthCheck() {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'No API key' };

  try {
    const res = await fetch('https://pia.goblincola.com/health', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return { ok: true, ...(await res.json()) };
    }
    return { ok: false, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Reset session state (forces re-initialization on next call)
 */
export function resetSession() {
  sessionId = null;
}
