'use strict';

const { unlinkSync, existsSync } = require('fs');
const { join } = require('path');
const process = require('process');

const { path } = require('../const');
const { initializeWorkingDirectory } = require('../utils');

const describe = 'Initialize the working directory';

/** @type {import('yargs').CommandModule<{}, InitArgs>} */
module.exports = {
  command: 'init',
  describe,
  builder: (yargs) =>
    yargs
      .usage(describe)
      .usage('Usage: $0 init [options]')
      .example('$0 init -C ~/.subscribe-you-tube-channel')
      .option('C', {
        alias: 'directory',
        description: 'Specify the working directory',
        default: process.cwd(),
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

    // Initialize the working directory
    initializeWorkingDirectory(
      cwd,
      join(cwd, path.downloads),
      join(cwd, path.subscriptions),
      lockFilePath
    ).subscribe({
      complete: () => {
        process.exit(0);
      },
      error: (error) => {
        logError(`❌ Initialize failed with Error: ${error}`);
        process.exit(1);
      },
    });
  },
};
