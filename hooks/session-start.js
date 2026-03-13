#!/usr/bin/env node
/**
 * SessionStart Hook (Global) - Register agent + load context from PIA MCP
 *
 * Runs once when a Claude Code session starts.
 * 1. Gets git email as fingerprint
 * 2. Calls registerAgent on remote MCP server
 * 3. Caches agent ID to ~/.claude/.pia-agent-id
 * 4. Injects technicalContext + unread messages
 */

import { callTool, callTools } from './lib/mcp-client.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = resolve(homedir(), '.claude');
const AGENT_ID_FILE = resolve(CLAUDE_DIR, '.pia-agent-id');

function outputContext(additionalContext) {
  if (additionalContext) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    }));
  }
  // exit 0 = success, no output needed for "no context" case
}

async function main() {
  try {
    // Step 1: Get fingerprint from git config
    let fingerprint;
    try {
      fingerprint = execSync('git config user.email', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      // Not in a git repo or no email configured
      outputContext(null);
      return;
    }

    if (!fingerprint) {
      outputContext(null);
      return;
    }

    // Step 2: Register agent via MCP
    let agentData;
    try {
      agentData = await callTool('registerAgent', {
        fingerprint,
        model: 'claude-opus-4-6',
        role: 'Coding Agent',
      });
    } catch (err) {
      // MCP server unreachable — don't block session
      console.error(`[Hook] registerAgent failed: ${err.message}`);
      outputContext(null);
      return;
    }

    if (!agentData || !agentData.agentId) {
      console.error('[Hook] registerAgent returned no agentId');
      outputContext(null);
      return;
    }

    // Step 3: Cache agent ID
    mkdirSync(CLAUDE_DIR, { recursive: true });
    writeFileSync(AGENT_ID_FILE, agentData.agentId, 'utf-8');

    // Step 4: Build context
    const contextParts = [];

    if (agentData.technicalContext) {
      contextParts.push(`## Your Persistent Memory (Claude)\n${agentData.technicalContext}`);
    }
    if (agentData.developerNotes) {
      contextParts.push(`## Developer Notes\n${agentData.developerNotes}`);
    }

    // Step 5: Get current user context + unread messages
    try {
      const [searchResult, messagesResult] = await callTools([
        {
          tool: 'search',
          args: { query: fingerprint, nodeTypes: 'Person', limit: 1 },
        },
        {
          tool: 'getMyMessages',
          args: { agentId: agentData.agentId, unreadOnly: true, limit: 10 },
        },
      ]);

      // Person context (from search results)
      const person = searchResult?.results?.[0] || searchResult?.matches?.[0];
      if (person) {
        let personContext = `## Current User: ${person.name || 'Unknown'}`;
        if (person.role) personContext += ` (${person.role})`;
        if (person.technicalContext) personContext += `\n${person.technicalContext}`;
        if (person.developerNotes) personContext += `\n\nNotes: ${person.developerNotes}`;
        contextParts.push(personContext);
      }

      // Unread messages
      if (messagesResult?.success && messagesResult.messages?.length > 0) {
        const msgs = messagesResult.messages;
        const lines = [`## Unread Messages (${messagesResult.unreadCount || msgs.length})`];
        for (const msg of msgs) {
          const priority = msg.priority === 'urgent' ? 'URGENT ' : msg.priority === 'high' ? '! ' : '';
          const preview = msg.message.length > 150 ? msg.message.substring(0, 150) + '...' : msg.message;
          lines.push(`${priority}**From ${msg.from}:** ${preview}`);
        }
        lines.push('');
        lines.push('_Use `getMyMessages` to see full messages, `markMessageRead` to mark as read._');
        contextParts.push(lines.join('\n'));
      }
    } catch (err) {
      console.error(`[Hook] Context enrichment failed: ${err.message}`);
    }

    // Step 6: Output
    if (contextParts.length > 0) {
      outputContext(contextParts.join('\n\n---\n\n'));
    }

  } catch (error) {
    console.error(`[Hook Error] ${error.message}`);
    outputContext(null);
  }
}

main();