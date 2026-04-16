'use strict';

const { unlinkSync, existsSync } = require('fs');
const { join } = require('path');
const process = require('process');

const { path } = require('../const');
const { downloadPlaylists } = require('../utils');

const describe = 'Download playlists from subscriptions';

/** @type {import('yargs').CommandModule<{}, MainArgs>} */
module.exports = {
  command: '$0',
  describe,
  usage: 'Usage: $0 [options]',

  builder: (yargs) =>
    yargs
      .usage('Usage: $0 [options]')
      .example(
        '$0 -C ~/.subscribe-you-tube-channel -o ~/Videos -Y /usr/bin/yt-dlp'
      )
      .option('C', {
        alias: 'directory',
        description: 'Specify the working directory',
        default: process.cwd(),
        type: 'string',
      })
      .option('o', {
        alias: 'download-directory',
        description: 'Specify the download directory',
        type: 'string',
      })
      .option('Y', {
        alias: 'yt-dlp-bin',
        description: 'Specify the path to yt-dlp binary',
        demandOption: true,
        type: 'string',
      })
      .option('q', {
        alias: 'quiet',
        description: 'Do not output to stdout or stderr',
        type: 'boolean',
        default: false,
      }),

  handler: (argv) => {
    const cwd = argv.C;
    const lockFilePath = join(cwd, path.lock);
    const downloadDirPath = argv.o ?? join(cwd, path.downloads);
    const subscriptionDirPath = join(cwd, path.subscriptions);
    const ytDlpBinPath = argv.Y;

    /**
     * log error message
     * @param {Error|string} error Error message
     * @returns {undefined}
     */
    const logError = (error) => {
      if (argv.q === true) {
        return;
      }

      console.error(error);
    };

    const cleanupLock = () => {
      try {
        if (existsSync(lockFilePath)) {
          unlinkSync(lockFilePath);
        }
      } catch (error) {
        logError(`❌ Unable to cleanup lock file. Error: ${error}`);
      }
    };
    process.on('exit', cleanupLock);
    process.on('SIGINT', () => {
      cleanupLock();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      cleanupLock();
      process.exit(143);
    });

    // Download playlists
    downloadPlaylists(
      cwd,
      downloadDirPath,
      subscriptionDirPath,
      lockFilePath,
      ytDlpBinPath,
      argv.q
    ).subscribe({
      complete: () => {
        process.exit(0);
      },
      error: (error) => {
        logError(`❌ Download subscription failed with Error: ${error}`);
        process.exit(1);
      },
    });
  },
};
