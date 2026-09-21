#!/usr/bin/env node
// Hypergro editor MCP server: exposes the scene operations layer (shared/scene.js TOOLS) to any MCP client.
// Register with Claude Code:  claude mcp add hypergro-editor -- node /abs/path/server/editor-server.mjs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TOOLS, runTool, normalize, understand } from '../shared/scene.js';

let scene = null, scenePath = null;
const LOCAL = [
  { name: 'load_scene', description: 'Load a scene.json (bundle folder or file path) into the session and run role detection.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'save_scene', description: 'Write the current scene to disk (defaults to the loaded path). Pass a new path to save a copy beside the original.', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
];
const need = () => { if (!scene) throw new Error('No scene loaded. Call load_scene first.'); };
const text = (t) => ({ content: [{ type: 'text', text: t }] });

const server = new Server({ name: 'hypergro-editor', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...LOCAL, ...TOOLS].map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) }));
// Tool calls are serialised: a client that fires load_scene and an edit back-to-back must see them applied in order.
let chain = Promise.resolve();
server.setRequestHandler(CallToolRequestSchema, (req) => (chain = chain.then(() => handle(req), () => handle(req))));
async function handle(req) {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'load_scene') {
      let p = args.path; if (!p.endsWith('.json')) p = path.join(p, 'scene.json');
      scene = understand(normalize(JSON.parse(await readFile(p, 'utf8')))); scenePath = p;
      const roles = {}; scene.elements.filter((e) => e.type !== 'group').forEach((e) => (roles[e.role] = (roles[e.role] || 0) + 1));
      return text(`Loaded ${scene.document.name} (${scene.document.width}×${scene.document.height}), ${scene.elements.length} elements. Roles: ${JSON.stringify(roles)}`);
    }
    if (name === 'save_scene') { need(); const p = args.path || scenePath; await writeFile(p, JSON.stringify(scene, null, 2)); return text(`Saved ${p}`); }
    need(); const out = runTool(scene, name, args); scene = out.scene; return text(out.result);
  } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
}
await server.connect(new StdioServerTransport());
