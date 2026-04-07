#!/usr/bin/env node

'use strict';

const {
  unlinkSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
} = require('fs');
const { join } = require('path');
const process = require('process');
const findProcess = require('find-process/lib/find_process');

/**
 * @type {{i: boolean, d: string, q: boolean, D: string, Y: string}}
 */
const argv = require('yargs')
  .usage('Usage: $0 [options]')
  .alias('d', 'directory')
  .nargs('d', 1)
  .string('d')
  .describe('d', 'Specify the working directory, defaults to cwd')
  .alias('i', 'init')
  .nargs('i', 0)
  .boolean('i')
  .describe('i', 'Initialize the working directory')
  .alias('D', 'download-directory')
  .nargs('D', 1)
  .string('D')
  .describe(
    'D',
    'Specify the download directory, defaults to downloads folder under the working directory'
  )
  .alias('Y', 'yt-dlp-bin')
  .nargs('Y', 1)
  .string('Y')
  .describe('Y', 'Specify the path to yt-dlp binary')
  .alias('q', 'quiet')
  .nargs('q', 0)
  .boolean('q')
  .describe('q', 'Do not output to stdout or stderr')
  .help('h')
  .alias('h', 'help').argv;

const { path } = require('./const');
const {
  readJsonFile,
  listSubscriptionFiles,
  generateSubDirectoryName,
  runYtDlp,
  removeOldVideos,
} = require('./utils');

const cwd = argv.d || process.cwd();
const downloadPath = argv.D || join(cwd, path.downloads);
const lockPath = join(cwd, path.lock);

/**
 * log error message
 * @param {Error|string} err Error message
 * @returns {undefined}
 */
function logError(err) {
  if (argv.q !== true) {
    console.error(err);
  }
}

/**
 * log message
 * @param {string} msg Message
 * @returns {undefined}
 */
function log(msg) {
  if (argv.q !== true) {
    console.log(msg);
  }
}

/**
 * init the current working directory
 * - create downloads folder, if not already exist
 * - create subscriptions folder, if not already exist
 * - create sample subscription file
 * @returns {Error|undefined} Error, if any
 */
function init() {
  let writePath = downloadPath;
  if (!existsSync(writePath)) {
    try {
      mkdirSync(writePath, { recursive: true });
    } catch (err) {
      return err;
    }
  }

  writePath = join(cwd, path.subscriptions);
  if (!existsSync(writePath)) {
    try {
      mkdirSync(writePath, { recursive: true });
    } catch (err) {
      return err;
    }
  }

  writePath = join(cwd, path.subscriptions, path.subscriptionSample);
  const subscriptionSample = {
    url: 'https://www.youtube.com/@ChannelName/videos',
    maxVideos: 10,
  };
  try {
    writeFileSync(writePath, JSON.stringify(subscriptionSample, null, 2));
  } catch (err) {
    return err;
  }
}

/**
 * download videos for a single subscription
 * @param {string} fileName subscription file name
 * @param {string} filePath path to subscription file
 * @returns {Promise<void>} resolves when subscription processing is complete
 */
async function processSubscription(fileName, filePath) {
  const subDirectoryName = generateSubDirectoryName(fileName);
  if (!subDirectoryName) {
    logError(`Unable to derive directory name from "${fileName}"`);
    return;
  }

  let fileContent;
  try {
    fileContent = readJsonFile(filePath);
  } catch (err) {
    logError(`Unable to read subscription "${filePath}". Error: ${err}`);
    return;
  }

  const { url, maxVideos } = fileContent;
  if (!url) {
    logError(`Subscription "${fileName}" has no url`);
    return;
  }

  const subDirectoryPath = join(downloadPath, subDirectoryName);
  if (!existsSync(subDirectoryPath)) {
    try {
      mkdirSync(subDirectoryPath, { recursive: true });
    } catch (err) {
      logError(
        `Unable to create sub-directory "${subDirectoryPath}". Error: ${err}`
      );
      return;
    }
  }

  // yt-dlp archive file tracks downloaded videos to avoid re-downloading
  const archivePath = join(subDirectoryPath, '.archive.txt');

  const args = [
    url,
    '-o',
    join(subDirectoryPath, '%(title)s [%(id)s].%(ext)s'),
    '--download-archive',
    archivePath,
    '--no-overwrites',
    '--write-info-json',
    // use node as JS runtime (already installed, avoids needing deno)
    '--js-runtimes',
    'node',
    // download challenge solver script from GitHub
    '--remote-components',
    'ejs:github',
    // sensible format: best mp4 up to 1080p, or best available
    '-f',
    'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
    '--merge-output-format',
    'mp4',
  ];

  if (maxVideos && maxVideos > 0) {
    args.push('--playlist-end', `${maxVideos}`);
  }

  if (argv.q) {
    args.push('--quiet');
  } else {
    args.push('--progress', '--newline');
  }

  log(`subscription: "${fileName}" → ${url}`);

  try {
    await runYtDlp(argv.Y, args);
    log('  done');
  } catch (err) {
    logError(`  error downloading from "${url}": ${err.message}`);
  }

  // remove oldest videos if count exceeds maxVideos
  if (maxVideos && maxVideos > 0) {
    const removed = removeOldVideos(subDirectoryPath, maxVideos, logError);
    if (removed > 0) {
      log(`  removed ${removed} old video(s)`);
    }
  }
}

/**
 * download from all subscriptions sequentially
 * @returns {Promise<void>} resolves when all subscriptions are processed
 */
async function main() {
  const subscriptionsPath = join(cwd, path.subscriptions);

  let subscriptionFiles;
  try {
    subscriptionFiles = listSubscriptionFiles(subscriptionsPath);
  } catch (err) {
    logError(`Unable to list subscriptions. Error: ${err}`);
    process.exit(1);
  }

  if (subscriptionFiles.length === 0) {
    log('No subscription files found.');
    return;
  }

  // process subscriptions sequentially to avoid overwhelming yt-dlp
  for (const { name } of subscriptionFiles) {
    const filePath = join(subscriptionsPath, name);
    // eslint-disable-next-line no-await-in-loop
    await processSubscription(name, filePath);
  }
}

/**
 * bootstrap - lock file, init, validate, then run main
 * @returns {Promise<void>} resolves when bootstrapping and main execution complete
 */
async function bootstrap() {
  // if another instance is already running at the working directory
  if (existsSync(lockPath)) {
    try {
      const { pid, startedAt } = JSON.parse(readFileSync(lockPath, 'utf8'));
      const [processMatch] = await findProcess({ pid });

      if (processMatch) {
        logError(
          `Another instance (pid: ${pid}) is already running at directory "${cwd}", and it started at ${startedAt}.`
        );
        process.exit(1);
      }
    } catch (err) {
      logError(`Unable to read lock file "${lockPath}". Error: ${err}`);
      process.exit(1);
    }

    try {
      unlinkSync(lockPath);
    } catch (err) {
      logError(
        `Unable to delete lock file that belongs to a previous instance "${lockPath}". Error: ${err}`
      );
      process.exit(1);
    }
  }

  /** @type {LockFileContent} */
  const lock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  } catch (err) {
    logError(`Unable to set lock file "${lockPath}". Error: ${err}`);
    process.exit(1);
  }

  const cleanupLock = () => {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch (_) {
      // best effort
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

  // if init
  if (argv.i) {
    const errInit = init();
    if (errInit) {
      logError(`Unable to initialize. Error: ${errInit}`);
      process.exit(1);
    }
    log(
      'Initialized. Edit subscriptions/sample.json with a YouTube channel or playlist URL.'
    );
    process.exit(0);
  }

  // if download directory is invalid
  if (!existsSync(downloadPath)) {
    logError(
      `Directory "${downloadPath}" does not exist. Run with --init first.`
    );
    process.exit(1);
  }

  // if the path to yt-dlp binary is not specified or the path is invalid
  if (!argv.Y || !existsSync(argv.Y)) {
    logError(
      `Path to yt-dlp "${
        argv.Y || ''
      }" does not exist. Specify with -Y /path/to/yt-dlp`
    );
    process.exit(1);
  }

  try {
    await main();
  } catch (err) {
    logError(`Unexpected error: ${err}`);
    process.exit(1);
  }
}

// if cwd is invalid
if (!existsSync(cwd)) {
  logError(`Directory "${cwd}" does not exist.`);
  process.exit(1);
}

bootstrap();
