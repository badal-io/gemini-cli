/**
 * @license
 * Copyright 2026 Badal
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  FileSearchClient,
  buildFilePathMetadataFilter,
  buildRepoMetadataFilter,
  combineMetadataFilters,
} from './file-search-client.js';

const client = new FileSearchClient();
const MCP_SERVER_NAME = 'fileSearch';
const QUALIFIED_TOOL_NAMES = {
  searchStore: `mcp_${MCP_SERVER_NAME}_search_store`,
  fetchFileContext: `mcp_${MCP_SERVER_NAME}_fetch_file_context`,
  fetchSymbolContext: `mcp_${MCP_SERVER_NAME}_fetch_symbol_context`,
  expandRelatedContext: `mcp_${MCP_SERVER_NAME}_expand_related_context`,
};
const FOLLOW_UP_TOOL_NAMES = [
  QUALIFIED_TOOL_NAMES.fetchFileContext,
  QUALIFIED_TOOL_NAMES.fetchSymbolContext,
  QUALIFIED_TOOL_NAMES.expandRelatedContext,
].join(', ');

const NextRetrievalSchema = z.object({
  tool: z.string(),
  reason: z.string(),
  args: z.record(z.unknown()),
});

const SearchStoreResultSchema = z.object({
  summary: z.string(),
  results: z.array(
    z.object({
      filePath: z.string(),
      reason: z.string(),
      snippetSummary: z.string(),
      recommendedNextTool: z.string(),
    }),
  ),
  insufficientContext: z.boolean(),
  missingContextReason: z.string(),
  nextRetrievals: z.array(NextRetrievalSchema),
});

const FileContextResultSchema = z.object({
  filePath: z.string(),
  summary: z.string(),
  relevantSymbols: z.array(z.string()),
  whyRelevant: z.string(),
  gaps: z.array(z.string()),
  needsMoreContext: z.boolean(),
  nextRetrievals: z.array(NextRetrievalSchema),
});

const SymbolContextResultSchema = z.object({
  symbol: z.string(),
  summary: z.string(),
  matches: z.array(
    z.object({
      filePath: z.string(),
      kind: z.string(),
      summary: z.string(),
    }),
  ),
  gaps: z.array(z.string()),
  needsMoreContext: z.boolean(),
  nextRetrievals: z.array(NextRetrievalSchema),
});

const ExpandRelatedContextResultSchema = z.object({
  seedFiles: z.array(z.string()),
  reason: z.string(),
  relatedFiles: z.array(
    z.object({
      filePath: z.string(),
      relationship: z.string(),
      whyRetrieveNext: z.string(),
    }),
  ),
  gaps: z.array(z.string()),
  needsMoreContext: z.boolean(),
  nextRetrievals: z.array(NextRetrievalSchema),
});

const nextRetrievalJsonSchema = {
  type: 'object',
  properties: {
    tool: { type: 'string' },
    reason: { type: 'string' },
    args: { type: 'object' },
  },
  required: ['tool', 'reason', 'args'],
};

const searchStoreJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          reason: { type: 'string' },
          snippetSummary: { type: 'string' },
          recommendedNextTool: { type: 'string' },
        },
        required: [
          'filePath',
          'reason',
          'snippetSummary',
          'recommendedNextTool',
        ],
      },
    },
    insufficientContext: { type: 'boolean' },
    missingContextReason: { type: 'string' },
    nextRetrievals: {
      type: 'array',
      items: nextRetrievalJsonSchema,
    },
  },
  required: [
    'summary',
    'results',
    'insufficientContext',
    'missingContextReason',
    'nextRetrievals',
  ],
};

const fileContextJsonSchema = {
  type: 'object',
  properties: {
    filePath: { type: 'string' },
    summary: { type: 'string' },
    relevantSymbols: {
      type: 'array',
      items: { type: 'string' },
    },
    whyRelevant: { type: 'string' },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    needsMoreContext: { type: 'boolean' },
    nextRetrievals: {
      type: 'array',
      items: nextRetrievalJsonSchema,
    },
  },
  required: [
    'filePath',
    'summary',
    'relevantSymbols',
    'whyRelevant',
    'gaps',
    'needsMoreContext',
    'nextRetrievals',
  ],
};

const symbolContextJsonSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    summary: { type: 'string' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          kind: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['filePath', 'kind', 'summary'],
      },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    needsMoreContext: { type: 'boolean' },
    nextRetrievals: {
      type: 'array',
      items: nextRetrievalJsonSchema,
    },
  },
  required: [
    'symbol',
    'summary',
    'matches',
    'gaps',
    'needsMoreContext',
    'nextRetrievals',
  ],
};

const expandRelatedContextJsonSchema = {
  type: 'object',
  properties: {
    seedFiles: {
      type: 'array',
      items: { type: 'string' },
    },
    reason: { type: 'string' },
    relatedFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          relationship: { type: 'string' },
          whyRetrieveNext: { type: 'string' },
        },
        required: ['filePath', 'relationship', 'whyRetrieveNext'],
      },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    needsMoreContext: { type: 'boolean' },
    nextRetrievals: {
      type: 'array',
      items: nextRetrievalJsonSchema,
    },
  },
  required: [
    'seedFiles',
    'reason',
    'relatedFiles',
    'gaps',
    'needsMoreContext',
    'nextRetrievals',
  ],
};

function formatResponse(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function formatError(error) {
  return formatResponse({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    configuration: client.getConfigurationSummary(),
  });
}

function buildScopedFilter(extraFilter) {
  return combineMetadataFilters(
    buildRepoMetadataFilter(client.config.repo),
    extraFilter,
  );
}

async function runStructuredRetrieval({
  prompt,
  metadataFilter,
  schema,
  validator,
}) {
  const result = await client.generateStructuredRetrieval({
    prompt,
    metadataFilter,
    responseJsonSchema: schema,
  });

  return {
    parsed: validator.parse(result.parsed),
    groundingMetadata: result.groundingMetadata,
    storeName: result.storeName,
  };
}

function buildSearchPrompt(query, maxResults) {
  return [
    'You are helping a coding agent decide what to retrieve next from a repository-scoped File Search index.',
    `User query: ${query}`,
    `Return at most ${maxResults} candidate files or contexts.`,
    'Be conservative and prefer narrow retrieval.',
    'If the query is ambiguous or the retrieved evidence looks partial, set insufficientContext to true and recommend follow-up retrieval steps.',
    `Every recommendedNextTool must be one of: ${FOLLOW_UP_TOOL_NAMES}.`,
    'Return JSON only.',
  ].join('\n');
}

function buildFileContextPrompt(filePath, task) {
  return [
    'You are grounding a coding agent on one file from a File Search index.',
    `Target file: ${filePath}`,
    `Task: ${task || 'Explain the most relevant context from this file.'}`,
    'Summarize only evidence supported by the retrieved chunks.',
    'If the chunks look partial, mention what is missing and which file or symbol should be fetched next.',
    `When recommending a follow-up tool in nextRetrievals, use one of: ${FOLLOW_UP_TOOL_NAMES}.`,
    'Return JSON only.',
  ].join('\n');
}

function buildSymbolContextPrompt(symbol, filePath, task) {
  return [
    'You are grounding a coding agent on a symbol from a File Search index.',
    `Target symbol: ${symbol}`,
    filePath ? `Preferred file: ${filePath}` : 'Search across the configured repository store.',
    `Task: ${task || 'Locate the most relevant declaration, usage, or surrounding context.'}`,
    'Prefer declarations and semantically closest usages.',
    'If the symbol appears ambiguous or incomplete, recommend bounded follow-up retrieval.',
    `When recommending a follow-up tool in nextRetrievals, use one of: ${FOLLOW_UP_TOOL_NAMES}.`,
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildExpandPrompt(seedFiles, reason, task, maxResults) {
  return [
    'You are helping a coding agent expand context from an initial retrieval result.',
    `Seed files: ${seedFiles.join(', ')}`,
    `Reason for expansion: ${reason}`,
    `Task: ${task || 'Find the most likely adjacent files to inspect next.'}`,
    `Return at most ${maxResults} related files.`,
    'Prefer callers, callees, definitions, imports, exported types, or implementation neighbors.',
    `When recommending a follow-up tool in nextRetrievals, use one of: ${FOLLOW_UP_TOOL_NAMES}.`,
    'Return JSON only.',
  ].join('\n');
}

const server = new McpServer({
  name: 'file-search-extension',
  version: '0.1.0',
});

server.registerTool(
  'search_store',
  {
    description:
      'Search the configured File Search store for the most relevant files or contexts for a query.',
    inputSchema: z
      .object({
        query: z.string().min(1),
        metadataFilter: z.string().optional(),
        maxResults: z.number().int().min(1).max(10).default(5),
      })
      .shape,
  },
  async ({ query, metadataFilter, maxResults = 5 }) => {
    try {
      const result = await runStructuredRetrieval({
        prompt: buildSearchPrompt(query, maxResults),
        metadataFilter: buildScopedFilter(metadataFilter),
        schema: searchStoreJsonSchema,
        validator: SearchStoreResultSchema,
      });

      return formatResponse({
        ok: true,
        tool: 'search_store',
        configuration: client.getConfigurationSummary(),
        storeName: result.storeName,
        result: result.parsed,
        groundingMetadata: result.groundingMetadata,
      });
    } catch (error) {
      return formatError(error);
    }
  },
);

server.registerTool(
  'fetch_file_context',
  {
    description:
      'Fetch focused context for a specific file path from the configured File Search store.',
    inputSchema: z
      .object({
        filePath: z.string().min(1),
        task: z.string().optional(),
      })
      .shape,
  },
  async ({ filePath, task }) => {
    try {
      const matches = await client.findDocumentsByFilePath(filePath);
      if (matches.length === 0) {
        return formatResponse({
          ok: false,
          tool: 'fetch_file_context',
          error: `No indexed document matched file path "${filePath}".`,
          suggestions: [],
          configuration: client.getConfigurationSummary(),
        });
      }

      const selected = matches[0];
      const result = await runStructuredRetrieval({
        prompt: buildFileContextPrompt(selected.filePath, task),
        metadataFilter: buildScopedFilter(
          buildFilePathMetadataFilter(selected.filePath),
        ),
        schema: fileContextJsonSchema,
        validator: FileContextResultSchema,
      });

      return formatResponse({
        ok: true,
        tool: 'fetch_file_context',
        configuration: client.getConfigurationSummary(),
        storeName: result.storeName,
        matchedDocuments: matches.slice(0, 5).map((match) => ({
          filePath: match.filePath,
          matchScore: match.matchScore,
        })),
        result: result.parsed,
        groundingMetadata: result.groundingMetadata,
      });
    } catch (error) {
      return formatError(error);
    }
  },
);

server.registerTool(
  'fetch_symbol_context',
  {
    description:
      'Fetch focused context for a symbol, optionally narrowed to a preferred file path.',
    inputSchema: z
      .object({
        symbol: z.string().min(1),
        filePath: z.string().optional(),
        task: z.string().optional(),
      })
      .shape,
  },
  async ({ symbol, filePath, task }) => {
    try {
      const matches = filePath
        ? await client.findDocumentsByFilePath(filePath)
        : [];
      const selectedFilePath = matches[0]?.filePath || filePath;

      const result = await runStructuredRetrieval({
        prompt: buildSymbolContextPrompt(symbol, selectedFilePath, task),
        metadataFilter: buildScopedFilter(
          selectedFilePath
            ? buildFilePathMetadataFilter(selectedFilePath)
            : undefined,
        ),
        schema: symbolContextJsonSchema,
        validator: SymbolContextResultSchema,
      });

      return formatResponse({
        ok: true,
        tool: 'fetch_symbol_context',
        configuration: client.getConfigurationSummary(),
        storeName: result.storeName,
        matchedDocuments: matches.slice(0, 5).map((match) => ({
          filePath: match.filePath,
          matchScore: match.matchScore,
        })),
        result: result.parsed,
        groundingMetadata: result.groundingMetadata,
      });
    } catch (error) {
      return formatError(error);
    }
  },
);

server.registerTool(
  'expand_related_context',
  {
    description:
      'Expand retrieval from one or more seed files when the first context fetch appears incomplete.',
    inputSchema: z
      .object({
        seedFiles: z.array(z.string().min(1)).min(1).max(5),
        reason: z.string().min(1),
        task: z.string().optional(),
        maxResults: z.number().int().min(1).max(10).default(5),
      })
      .shape,
  },
  async ({ seedFiles, reason, task, maxResults = 5 }) => {
    try {
      const result = await runStructuredRetrieval({
        prompt: buildExpandPrompt(seedFiles, reason, task, maxResults),
        metadataFilter: buildScopedFilter(),
        schema: expandRelatedContextJsonSchema,
        validator: ExpandRelatedContextResultSchema,
      });

      return formatResponse({
        ok: true,
        tool: 'expand_related_context',
        configuration: client.getConfigurationSummary(),
        storeName: result.storeName,
        result: result.parsed,
        groundingMetadata: result.groundingMetadata,
      });
    } catch (error) {
      return formatError(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
