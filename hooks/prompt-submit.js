#!/usr/bin/env node
/**
 * UserPromptSubmit Hook (Global) - Re-inject context after compaction
 *
 * Runs before each user message is processed.
 * - If .needs-reinject marker exists: full context re-injection via MCP
 * - If no marker: minimal identity reminder (~50 tokens)
 */

import { callTool, callTools, resetSession } from './lib/mcp-client.js';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CLAUDE_DIR = resolve(homedir(), '.claude');
const AGENT_ID_FILE = resolve(CLAUDE_DIR, '.pia-agent-id');
const MARKER_FILE = resolve(CLAUDE_DIR, '.needs-reinject');

function outputContext(additionalContext) {
  if (additionalContext) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    }));
  }
}

function getCachedAgentId() {
  try {
    return readFileSync(AGENT_ID_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function main() {
  const needsReinject = existsSync(MARKER_FILE);

  if (needsReinject) {
    // Full context re-injection after compaction
    try {
      const agentId = getCachedAgentId();
      if (!agentId) {
        // No cached agent ID — can't re-inject, remove marker
        try { unlinkSync(MARKER_FILE); } catch {}
        return;
      }

      // Reset MCP session (old one may have expired)
      resetSession();

      // Fetch agent context + person context + messages sequentially
      let fingerprint;
      try {
        fingerprint = execSync('git config user.email', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      } catch {
        fingerprint = null;
      }

      const calls = [
        { tool: 'manageEntity', args: { operation: 'get', type: 'Agent', id: agentId } },
        { tool: 'getMyMessages', args: { agentId, unreadOnly: true, limit: 10 } },
      ];
      if (fingerprint) {
        calls.push({ tool: 'search', args: { query: fingerprint, nodeTypes: 'Person', limit: 1 } });
      }

      const results = await callTools(calls);
      const [agentResult, messagesResult, searchResult] = results;

      const contextParts = ['**[Context Re-injected After Compaction]**'];

      // Agent memory
      if (agentResult?.success && agentResult.entity) {
        const agent = agentResult.entity;
        if (agent.technicalContext) {
          contextParts.push(`## Your Persistent Memory (Claude)\n${agent.technicalContext}`);
        }
        if (agent.developerNotes) {
          contextParts.push(`## Developer Notes\n${agent.developerNotes}`);
        }
      }

      // Person context (from search results)
      const person = searchResult?.results?.[0] || searchResult?.matches?.[0];
      if (person) {
        let personContext = `## Current User: ${person.name || 'Unknown'}`;
        if (person.role) personContext += ` (${person.role})`;
        if (person.technicalContext) personContext += `\n${person.technicalContext}`;
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

      // Remove marker
      try { unlinkSync(MARKER_FILE); } catch {}

      outputContext(contextParts.join('\n\n---\n\n'));

    } catch (error) {
      console.error(`[Hook Error] ${error.message}`);
      // Remove marker even on error to avoid infinite re-injection attempts
      try { unlinkSync(MARKER_FILE); } catch {}
    }

  } else {
    // Minimal identity reminder (~50 tokens)
    outputContext('You are Claude, the Coding Agent. Use `updateMyContext` and `archiveToMyContext` MCP tools to persist important learnings.');
  }
}

main();