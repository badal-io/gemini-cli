/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    suffix,
  };
});

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    GEMINI_DIR: '.gemini',
    homedir: () => path.join(os.tmpdir(), `gemini-home-${mocks.suffix}`),
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('loadExtensions', () => {
  const mockHomeDir = path.join(os.tmpdir(), `gemini-home-${mocks.suffix}`);
  const mockWorkspaceDir = path.join(
    os.tmpdir(),
    `gemini-workspace-${mocks.suffix}`,
  );

  beforeEach(() => {
    fs.mkdirSync(mockHomeDir, { recursive: true });
    fs.mkdirSync(mockWorkspaceDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(mockHomeDir, { recursive: true, force: true });
    fs.rmSync(mockWorkspaceDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('hydrates extension path variables in mcp server configs', async () => {
    const extensionDir = path.join(
      mockHomeDir,
      '.gemini',
      'extensions',
      'test-extension',
    );
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.writeFileSync(
      path.join(extensionDir, 'gemini-extension.json'),
      JSON.stringify({
        name: 'test-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['${extensionPath}${/}server${/}index.js'],
            cwd: '${extensionPath}${/}server',
          },
        },
      }),
    );

    const { loadExtensions } = await import('./extension.js');
    const extensions = loadExtensions(mockWorkspaceDir);

    expect(extensions).toHaveLength(1);
    expect(extensions[0].mcpServers?.['test-server']).toEqual({
      command: 'node',
      args: [path.join(extensionDir, 'server', 'index.js')],
      cwd: path.join(extensionDir, 'server'),
    });
  });
});
