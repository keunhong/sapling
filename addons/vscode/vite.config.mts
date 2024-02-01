/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {Plugin} from 'vite';

import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import styleX from 'vite-plugin-stylex';
import viteTsconfigPaths from 'vite-tsconfig-paths';

// vite-plugin-stylex doesn't support renaming the output CSS file, so we have to do that ourselves.
function moveStylexFilenamePlugin(): Plugin {
  return {
    name: 'move-stylex-filename',
    writeBundle(options, bundle) {
      for (const name in bundle) {
        const chunk = bundle[name];
        // Check if this is the stylex output cssfile
        if (chunk.type === 'asset' && /assets[/\\]stylex\.[a-f0-9]+\.css/.test(chunk.fileName)) {
          // Rename the file, move it from "assets" to "res" where the rest of our assets are
          const newName = 'res/stylex.css';
          if (options.dir == null) {
            this.error('Could not replace StyleX output, dir must be set');
          }
          const dir = options.dir as string;
          const oldPath = path.resolve(dir, chunk.fileName);
          const newPath = path.resolve(dir, newName);
          this.info(`Replacing StyleX output file ${chunk.fileName} with ${newName}`);
          fs.renameSync(oldPath, newPath);
          // Update the bundle object
          chunk.fileName = newName;
          bundle[newName] = chunk;
          delete bundle[name];
        }
      }
    },
  };
}

export default defineConfig(({mode}) => ({
  base: '',
  plugins: [
    react({
      include: '**/*.tsx',
    }),
    styleX(),
    viteTsconfigPaths(),
    moveStylexFilenamePlugin(),
  ],
  build: {
    outDir: 'dist/webview',
    manifest: true,
    rollupOptions: {
      input: 'webview.html',
      output: {
        // Don't use hashed names, so ISL webview panel can pre-define what filename to load
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: 'res/[name].[ext]',
      },
    },
    copyPublicDir: true,
    // No need for source maps in production. We can always build them locally to understand a wild stack trace.
    sourcemap: mode === 'development',
  },
  publicDir: '../isl/public',
  server: {
    // No need to open the browser, we run inside vscode and don't really connect to the server.
    open: false,
    port: 3005,
  },
}));