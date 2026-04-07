'use strict';

const { readFileSync, readdirSync, unlinkSync, writeFileSync } = require('fs');
const { join } = require('path');
const { spawn } = require('child_process');

/**
 * read a JSON file synchronously
 * @param {string} readPath path to file
 * @returns {object} parsed JSON
 */
function readJsonFile(readPath) {
  return JSON.parse(readFileSync(readPath, 'utf8'));
}

/**
 * generate sub-directory name from subscription file name (strip extension)
 * @param {string} fileName Subscription file name
 * @returns {string|null} sub-directory name
 */
function generateSubDirectoryName(fileName) {
  const match = fileName.match(/^(.*)\./);
  if (!match || !match[1] || match[1].trim().length === 0) {
    return null;
  }
  return match[1];
}

/**
 * list subscription JSON files in a directory
 * @param {string} readPath path to directory containing subscription files
 * @returns {Array} array of directory entries
 */
function listSubscriptionFiles(readPath) {
  const entries = readdirSync(readPath, { withFileTypes: true });
  return entries.filter(({ name }) => /\.json$/i.test(name));
}

/**
 * run yt-dlp and return a promise that resolves on success or rejects on failure
 * @param {string} ytDlpBin path to yt-dlp binary
 * @param {string[]} args arguments to pass to yt-dlp
 * @param {object} [options] options
 * @param {boolean} [options.captureStdout] if true, resolve with captured stdout
 * @returns {Promise<string>} resolves with stdout (if captured) or empty string
 */
function runYtDlp(ytDlpBin, args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(captureStdout ? Buffer.concat(stdoutChunks).toString() : '');
      } else {
        const stderr = Buffer.concat(stderrChunks).toString();
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * remove oldest videos when count exceeds maxVideos, updating the archive file
 * @param {string} dirPath path to the subscription's download directory
 * @param {number} maxVideos maximum number of videos to keep
 * @param {function} [logError] error logging function
 * @returns {number} number of videos removed
 */
function removeOldVideos(dirPath, maxVideos, logError) {
  const files = readdirSync(dirPath);
  const infoFiles = files.filter(
    (f) => f.endsWith('.info.json') && !f.includes('[PL')
  );

  if (infoFiles.length <= maxVideos) {
    return 0;
  }

  // read upload_date from each info.json and pair with video ID
  const videos = [];
  for (const infoFile of infoFiles) {
    try {
      const info = JSON.parse(readFileSync(join(dirPath, infoFile), 'utf8'));
      videos.push({
        id: info.id,
        uploadDate: info.upload_date || '00000000',
        infoFile,
      });
    } catch (err) {
      if (logError) {
        logError(`  unable to read "${infoFile}": ${err.message}`);
      }
    }
  }

  // sort newest first by upload_date
  videos.sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));

  const toRemove = videos.slice(maxVideos);
  let removed = 0;

  for (const video of toRemove) {
    // find and remove the mp4 and info.json files for this video ID
    const relatedFiles = files.filter((f) => f.includes(`[${video.id}]`));
    for (const file of relatedFiles) {
      try {
        unlinkSync(join(dirPath, file));
      } catch (err) {
        if (logError) {
          logError(`  unable to remove "${file}": ${err.message}`);
        }
      }
    }
    removed += 1;
  }

  // rebuild archive file to match remaining videos
  const archivePath = join(dirPath, '.archive.txt');
  const kept = videos.slice(0, maxVideos);
  const archiveContent = `${kept.map((v) => `youtube ${v.id}`).join('\n')}\n`;
  try {
    writeFileSync(archivePath, archiveContent);
  } catch (err) {
    if (logError) {
      logError(`  unable to update archive: ${err.message}`);
    }
  }

  return removed;
}

module.exports = {
  readJsonFile,
  generateSubDirectoryName,
  listSubscriptionFiles,
  runYtDlp,
  removeOldVideos,
};
