/**
 * @license
 * Copyright 2026 Badal
 * SPDX-License-Identifier: Apache-2.0
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_FILE_SEARCH_MODEL = 'gemini-3-flash-preview';
const FILE_SEARCH_LIST_PAGE_SIZE = 20;

export function getRuntimeConfig(env = process.env) {
  const apiKey = env.FILE_SEARCH_API_KEY || env.GEMINI_API_KEY;
  const googleAccessToken =
    env.FILE_SEARCH_GOOGLE_ACCESS_TOKEN || env.GOOGLE_ACCESS_TOKEN;

  return {
    authMode:
      env.FILE_SEARCH_AUTH_MODE ||
      (apiKey ? 'api_key' : googleAccessToken ? 'oauth' : 'unconfigured'),
    apiKey,
    googleAccessToken,
    baseUrl: env.FILE_SEARCH_API_BASE_URL || DEFAULT_BASE_URL,
    storeName: env.FILE_SEARCH_STORE_NAME,
    repo: env.FILE_SEARCH_REPO,
    sourceRepository: env.FILE_SEARCH_SOURCE_REPOSITORY,
    model: env.FILE_SEARCH_MODEL || DEFAULT_FILE_SEARCH_MODEL,
  };
}

export function escapeMetadataValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function combineMetadataFilters(...filters) {
  return filters.filter(Boolean).join(' AND ');
}

export function buildRepoMetadataFilter(repo) {
  return repo ? `repo="${escapeMetadataValue(repo)}"` : undefined;
}

export function buildFilePathMetadataFilter(filePath) {
  return filePath ? `file_path="${escapeMetadataValue(filePath)}"` : undefined;
}

export function stripCodeFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

export function parseJsonResponse(text) {
  return JSON.parse(stripCodeFences(text));
}

export function extractResponseText(response) {
  return (
    response?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || ''
  );
}

export function documentToRecord(document) {
  const metadata = {};
  for (const item of document.customMetadata || []) {
    metadata[item.key] = item.stringValue || '';
  }

  return {
    name: document.name,
    displayName: document.displayName,
    filePath: metadata.file_path || document.displayName || '',
    language: metadata.language || 'unknown',
    contentHash: metadata.content_hash || '',
    astSummary: metadata.ast_summary || '',
    tags: Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) =>
          !['file_path', 'language', 'content_hash', 'ast_summary'].includes(key),
      ),
    ),
    state: document.state || 'unknown',
    raw: document,
  };
}

export function scorePathMatch(targetPath, candidatePath) {
  if (!targetPath || !candidatePath) {
    return 0;
  }

  const normalizedTarget = targetPath.replace(/^[./]+/, '').toLowerCase();
  const normalizedCandidate = candidatePath.replace(/^[./]+/, '').toLowerCase();

  if (normalizedCandidate === normalizedTarget) {
    return 100;
  }
  if (normalizedCandidate.endsWith(`/${normalizedTarget}`)) {
    return 90;
  }
  if (normalizedCandidate.includes(normalizedTarget)) {
    return 70;
  }
  return 0;
}

export class FileSearchClient {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    if (!fetchImpl) {
      throw new Error('A global fetch implementation is required.');
    }

    this.fetch = fetchImpl;
    this.config = getRuntimeConfig(env);
    this.storeResourceName = undefined;
  }

  getConfigurationSummary() {
    return {
      authMode: this.config.authMode,
      storeName: this.config.storeName,
      repo: this.config.repo,
      sourceRepository: this.config.sourceRepository,
      model: this.config.model,
    };
  }

  assertReady() {
    if (!this.config.storeName) {
      throw new Error(
        'File Search is not configured for this session because FILE_SEARCH_STORE_NAME is missing.',
      );
    }

    if (!this.config.apiKey && !this.config.googleAccessToken) {
      throw new Error(
        'File Search is not authenticated for this session because neither FILE_SEARCH_API_KEY nor FILE_SEARCH_GOOGLE_ACCESS_TOKEN is available.',
      );
    }
  }

  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['x-goog-api-key'] = this.config.apiKey;
    } else if (this.config.googleAccessToken) {
      headers.Authorization = `Bearer ${this.config.googleAccessToken}`;
    }

    return headers;
  }

  buildUrl(path, searchParams) {
    const url = new URL(`/v1beta/${path}`, this.config.baseUrl);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request(path, { method = 'GET', body, searchParams } = {}) {
    this.assertReady();

    const response = await this.fetch(this.buildUrl(path, searchParams), {
      method,
      headers: this.buildHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error?.message || parsed.error || text;
      } catch {
        // Keep raw text when response is not JSON.
      }
      throw new Error(
        `File Search API request failed (${response.status} ${response.statusText}): ${detail}`,
      );
    }

    if (response.status === 204) {
      return undefined;
    }

    return response.json();
  }

  async listStores() {
    const stores = [];
    let pageToken;

    do {
      const response = await this.request('fileSearchStores', {
        searchParams: {
          pageSize: FILE_SEARCH_LIST_PAGE_SIZE,
          pageToken,
        },
      });
      stores.push(...(response.fileSearchStores || []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return stores;
  }

  async resolveStoreResourceName() {
    this.assertReady();

    if (this.storeResourceName) {
      return this.storeResourceName;
    }

    if (this.config.storeName.startsWith('fileSearchStores/')) {
      this.storeResourceName = this.config.storeName;
      return this.storeResourceName;
    }

    const stores = await this.listStores();
    const match = stores.find(
      (store) =>
        store.displayName === this.config.storeName ||
        store.name === this.config.storeName ||
        store.name?.endsWith(`/${this.config.storeName}`),
    );

    if (!match?.name) {
      throw new Error(
        `Could not find a File Search store named "${this.config.storeName}".`,
      );
    }

    this.storeResourceName = match.name;
    return this.storeResourceName;
  }

  async listDocuments() {
    const storeName = await this.resolveStoreResourceName();
    const documents = [];
    let pageToken;

    do {
      const response = await this.request(`${storeName}/documents`, {
        searchParams: {
          pageSize: FILE_SEARCH_LIST_PAGE_SIZE,
          pageToken,
        },
      });
      documents.push(...(response.documents || []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return documents.map(documentToRecord);
  }

  async getDocument(documentName) {
    const raw = await this.request(documentName);
    return documentToRecord(raw);
  }

  async findDocumentsByFilePath(filePath) {
    const documents = await this.listDocuments();
    return documents
      .map((document) => ({
        ...document,
        matchScore: scorePathMatch(filePath, document.filePath),
      }))
      .filter((document) => document.matchScore > 0)
      .sort((left, right) => right.matchScore - left.matchScore);
  }

  async generateStructuredRetrieval({
    prompt,
    metadataFilter,
    responseJsonSchema,
  }) {
    const storeName = await this.resolveStoreResourceName();
    const response = await this.request(
      `models/${this.config.model}:generateContent`,
      {
        method: 'POST',
        body: {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [storeName],
                ...(metadataFilter ? { metadataFilter } : {}),
              },
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema,
            temperature: 0.1,
          },
        },
      },
    );

    const text = extractResponseText(response);
    return {
      text,
      parsed: parseJsonResponse(text),
      groundingMetadata:
        response?.candidates?.[0]?.groundingMetadata || response?.groundingMetadata,
      storeName,
    };
  }
}
