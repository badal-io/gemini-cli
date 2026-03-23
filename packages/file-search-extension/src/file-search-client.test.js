/**
 * @license
 * Copyright 2026 Badal
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  FileSearchClient,
  buildFilePathMetadataFilter,
  buildRepoMetadataFilter,
  combineMetadataFilters,
  getRuntimeConfig,
  scorePathMatch,
} from './file-search-client.js';

describe('getRuntimeConfig', () => {
  it('prefers file-search specific env vars', () => {
    const config = getRuntimeConfig({
      FILE_SEARCH_API_KEY: 'file-search-key',
      FILE_SEARCH_GOOGLE_ACCESS_TOKEN: 'google-token',
      FILE_SEARCH_STORE_NAME: 'repo-devex-backstage',
      FILE_SEARCH_REPO: 'repo-devex-backstage',
      FILE_SEARCH_AUTH_MODE: 'vault',
    });

    expect(config.apiKey).toBe('file-search-key');
    expect(config.googleAccessToken).toBe('google-token');
    expect(config.storeName).toBe('repo-devex-backstage');
    expect(config.repo).toBe('repo-devex-backstage');
    expect(config.authMode).toBe('vault');
  });
});

describe('metadata filter helpers', () => {
  it('builds scoped metadata filters', () => {
    expect(
      combineMetadataFilters(
        buildRepoMetadataFilter('repo-devex-backstage'),
        buildFilePathMetadataFilter('plugins/gemini-agent-backend/src/router.ts'),
      ),
    ).toBe(
      'repo="repo-devex-backstage" AND file_path="plugins/gemini-agent-backend/src/router.ts"',
    );
  });
});

describe('scorePathMatch', () => {
  it('scores exact matches highest', () => {
    expect(
      scorePathMatch(
        'plugins/gemini-agent-backend/src/router.ts',
        'plugins/gemini-agent-backend/src/router.ts',
      ),
    ).toBe(100);
  });

  it('scores suffix path matches', () => {
    expect(
      scorePathMatch(
        'src/router.ts',
        'plugins/gemini-agent-backend/src/router.ts',
      ),
    ).toBe(90);
  });
});

describe('FileSearchClient', () => {
  it('uses API key auth when present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fileSearchStores: [{ name: 'fileSearchStores/repo', displayName: 'repo' }],
      }),
    });

    const client = new FileSearchClient({
      env: {
        FILE_SEARCH_API_KEY: 'api-key',
        FILE_SEARCH_STORE_NAME: 'repo',
      },
      fetchImpl,
    });

    await client.resolveStoreResourceName();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/fileSearchStores?pageSize=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': 'api-key',
        }),
      }),
    );
  });

  it('uses bearer auth when only a Google token is available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fileSearchStores: [{ name: 'fileSearchStores/repo', displayName: 'repo' }],
      }),
    });

    const client = new FileSearchClient({
      env: {
        FILE_SEARCH_GOOGLE_ACCESS_TOKEN: 'google-token',
        FILE_SEARCH_STORE_NAME: 'repo',
      },
      fetchImpl,
    });

    await client.resolveStoreResourceName();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/fileSearchStores?pageSize=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer google-token',
        }),
      }),
    );
  });

  it('sorts file path matches by exactness', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        documents: [
          {
            name: 'fileSearchStores/repo/documents/a',
            displayName: 'router.ts',
            customMetadata: [
              { key: 'file_path', stringValue: 'src/router.ts' },
            ],
          },
          {
            name: 'fileSearchStores/repo/documents/b',
            displayName: 'router.ts',
            customMetadata: [
              {
                key: 'file_path',
                stringValue: 'plugins/gemini-agent-backend/src/router.ts',
              },
            ],
          },
        ],
      }),
    });

    const client = new FileSearchClient({
      env: {
        FILE_SEARCH_API_KEY: 'api-key',
        FILE_SEARCH_STORE_NAME: 'fileSearchStores/repo',
      },
      fetchImpl,
    });

    const matches = await client.findDocumentsByFilePath('src/router.ts');
    expect(matches[0].filePath).toBe('src/router.ts');
    expect(matches[1].filePath).toBe(
      'plugins/gemini-agent-backend/src/router.ts',
    );
  });
});
