/**
 * @license
 * Copyright 2026 Badal
 * SPDX-License-Identifier: Apache-2.0
 */

const storeName = process.env.FILE_SEARCH_STORE_NAME;
const repo = process.env.FILE_SEARCH_REPO;
const sourceRepository = process.env.FILE_SEARCH_SOURCE_REPOSITORY;
const authMode = process.env.FILE_SEARCH_AUTH_MODE || 'unconfigured';

const lines = [];
if (storeName) {
  lines.push(`File Search store: ${storeName}`);
}
if (repo) {
  lines.push(`File Search repo tag: ${repo}`);
}
if (sourceRepository) {
  lines.push(`Source repository: ${sourceRepository}`);
}
lines.push(`File Search auth mode: ${authMode}`);
lines.push(
  'Use File Search tools when local context is missing, partial, or points to neighboring files.',
);
lines.push('Search first, then fetch narrowly, then expand only if needed.');

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'BeforeAgent',
      additionalContext: lines.join('\n'),
    },
  }),
);
