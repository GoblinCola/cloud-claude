#!/usr/bin/env node
/**
 * PreCompact Hook (Global) - Archive before context compaction
 *
 * Runs before Claude Code compacts the conversation.
 * 1. Archives compaction summary to agent's protected storage via MCP
 * 2. Writes .needs-reinject marker so prompt-submit knows to re-inject
 */

import { callTool, resetSession } from './lib/mcp-client.js';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = resolve(homedir(), '.claude');
const AGENT_ID_FILE = resolve(CLAUDE_DIR, '.pia-agent-id');
const MARKER_FILE = resolve(CLAUDE_DIR, '.needs-reinject');

function getCachedAgentId() {
  try {
    return readFileSync(AGENT_ID_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function main() {
  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData = {};
  try {
    hookData = JSON.parse(input);
  } catch {
    // No input or invalid JSON
  }

  try {
    const agentId = getCachedAgentId();
    if (!agentId) {
      // No cached agent ID — just write marker and continue
      const timestamp = new Date().toISOString();
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(MARKER_FILE, timestamp);
      // exit 0 = success
      return;
    }

    // Reset session for fresh connection
    resetSession();

    const summary = hookData.summary || 'Session compacted - context was preserved via PreCompact hook';
    const timestamp = new Date().toISOString();

    // Archive the compaction summary
    try {
      await callTool('archiveToMyContext', {
        agentId,
        content: `[COMPACTION] ${timestamp}\n${summary}`,
        tag: 'COMPACTION',
      });
    } catch (err) {
      console.error(`[Hook] Archive failed: ${err.message}`);
      // Continue anyway — marker is more important
    }

    // Write marker file for re-injection
    mkdirSync(CLAUDE_DIR, { recursive: true });
    writeFileSync(MARKER_FILE, timestamp);

    // exit 0 = success

  } catch (error) {
    console.error(`[Hook Error] ${error.message}`);
    // Still write marker as best-effort
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(MARKER_FILE, new Date().toISOString());
    } catch {}
    // exit 0 = success
  }
}

main();
