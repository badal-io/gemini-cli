/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Copied exactly from packages/cli/src/config/extension.ts, last PR #1026

import {
  GEMINI_DIR,
  type MCPServerConfig,
  type ExtensionInstallMetadata,
  type GeminiCLIExtension,
  homedir,
} from '@google/gemini-cli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

export const EXTENSIONS_DIRECTORY_NAME = path.join(GEMINI_DIR, 'extensions');
export const EXTENSIONS_CONFIG_FILENAME = 'gemini-extension.json';
export const INSTALL_METADATA_FILENAME = '.gemini-extension-install.json';

/**
 * Extension definition as written to disk in gemini-extension.json files.
 * This should *not* be referenced outside of the logic for reading files.
 * If information is required for manipulating extensions (load, unload, update)
 * outside of the loading process that data needs to be stored on the
 * GeminiCLIExtension class defined in Core.
 */
interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
}

type VariableContext = {
  [key: string]: string | undefined;
};

const UNMARSHALL_KEY_IGNORE_LIST: Set<string> = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
]);

export function loadExtensions(workspaceDir: string): GeminiCLIExtension[] {
  const allExtensions = [
    ...loadExtensionsFromDir(workspaceDir, workspaceDir),
    ...loadExtensionsFromDir(homedir(), workspaceDir),
  ];

  const uniqueExtensions: GeminiCLIExtension[] = [];
  const seenNames = new Set<string>();
  for (const extension of allExtensions) {
    if (!seenNames.has(extension.name)) {
      logger.info(
        `Loading extension: ${extension.name} (version: ${extension.version})`,
      );
      uniqueExtensions.push(extension);
      seenNames.add(extension.name);
    }
  }

  return uniqueExtensions;
}

function loadExtensionsFromDir(
  dir: string,
  workspaceDir: string,
): GeminiCLIExtension[] {
  const extensionsDir = path.join(dir, EXTENSIONS_DIRECTORY_NAME);
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const extensions: GeminiCLIExtension[] = [];
  for (const subdir of fs.readdirSync(extensionsDir)) {
    const extensionDir = path.join(extensionsDir, subdir);

    const extension = loadExtension(extensionDir, workspaceDir);
    if (extension != null) {
      extensions.push(extension);
    }
  }
  return extensions;
}

function loadExtension(
  extensionDir: string,
  workspaceDir: string,
): GeminiCLIExtension | null {
  if (!fs.statSync(extensionDir).isDirectory()) {
    logger.error(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return null;
  }

  const configFilePath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configFilePath)) {
    logger.error(
      `Warning: extension directory ${extensionDir} does not contain a config file ${configFilePath}.`,
    );
    return null;
  }

  try {
    const configContent = fs.readFileSync(configFilePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const rawConfig = JSON.parse(configContent) as ExtensionConfig;
    const config = recursivelyHydrateStrings(rawConfig, {
      extensionPath: extensionDir,
      workspacePath: workspaceDir,
      '/': path.sep,
      pathSeparator: path.sep,
    });
    if (!config.name || !config.version) {
      logger.error(
        `Invalid extension config in ${configFilePath}: missing name or version.`,
      );
      return null;
    }

    const installMetadata = loadInstallMetadata(extensionDir);

    const contextFiles = getContextFileNames(config)
      .map((contextFileName) => path.join(extensionDir, contextFileName))
      .filter((contextFilePath) => fs.existsSync(contextFilePath));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {
      name: config.name,
      version: config.version,
      path: extensionDir,
      contextFiles,
      installMetadata,
      mcpServers: config.mcpServers,
      excludeTools: config.excludeTools,
      isActive: true, // Barring any other signals extensions should be considered Active.
    } as GeminiCLIExtension;
  } catch (e) {
    logger.error(
      `Warning: error parsing extension config in ${configFilePath}: ${e}`,
    );
    return null;
  }
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (!config.contextFileName) {
    return ['GEMINI.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

export function loadInstallMetadata(
  extensionDir: string,
): ExtensionInstallMetadata | undefined {
  const metadataFilePath = path.join(extensionDir, INSTALL_METADATA_FILENAME);
  try {
    const configContent = fs.readFileSync(metadataFilePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metadata = JSON.parse(configContent) as ExtensionInstallMetadata;
    return metadata;
  } catch (e) {
    logger.warn(
      `Failed to load or parse extension install metadata at ${metadataFilePath}: ${e}`,
    );
    return undefined;
  }
}

function hydrateString(str: string, context: VariableContext): string {
  const regex = /\${(.*?)}/g;
  return str.replace(regex, (match, key) =>
    context[key] == null ? match : context[key],
  );
}

function recursivelyHydrateStrings<T>(obj: T, values: VariableContext): T {
  if (typeof obj === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return hydrateString(obj, values) as unknown as T;
  }
  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return obj.map((item) =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      recursivelyHydrateStrings(item, values),
    ) as unknown as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {};
    for (const key in obj) {
      if (
        !UNMARSHALL_KEY_IGNORE_LIST.has(key) &&
        Object.prototype.hasOwnProperty.call(obj, key)
      ) {
        newObj[key] = recursivelyHydrateStrings(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (obj as Record<string, unknown>)[key],
          values,
        );
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return newObj as T;
  }
  return obj;
}
