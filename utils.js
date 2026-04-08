'use strict';

const { readdir, readFile, access } = require('fs/promises');
const { spawn } = require('child_process');
const { Observable, of, from, defer } = require('rxjs');
const { concatMap, map, mapTo, catchError } = require('rxjs/operators');
const { findProcess } = require('find-process/lib/find_process');

/**
 * check if a process with the given PID is still running
 * @param {string} lockFilePath path to the lock file
 * @returns {Promise<boolean>} true if the process is running, false otherwise
 */
function isPreviousInstanceRunning(lockFilePath) {
  return readFile(lockFilePath, 'utf8')
    .then(JSON.parse)
    .then(({ pid }) => findProcess({ pid }))
    .then(([processMatch]) => !!processMatch);
}

/**
 * check if a file or directory exists
 * @param {string} filePath path to check
 * @returns {Observable<boolean>} Observable emitting true if the path is accessible
 */
function fileExists(filePath) {
  return defer(() => access(filePath)).pipe(
    mapTo(true),
    catchError(() => of(false))
  );
}

/**
 * list subscription files, emit sequentially
 * @param {string} readPath directory containing subscription files
 * @return {Observable<Dirent>} Observable of subscription files
 */
function listSubscriptionFiles(readPath) {
  return defer(() => readdir(readPath, { withFileTypes: true })).pipe(
    map((fileDirents) =>
      fileDirents.filter(({ name }) => /.*\.json$/i.test(name))
    ),
    concatMap(from)
  );
}

/**
 * spawn yt-dlp as a child process
 * @param {string} ytDlpBin path to yt-dlp binary
 * @param {string[]} args arguments to pass to yt-dlp
 * @param {boolean} captureStdout if true, emit captured stdout on success
 * @returns {Observable<string>} emits stdout (if captured) on success, or an error on failure
 */
function runYtDlp(ytDlpBin, args, captureStdout) {
  return new Observable((subscriber) => {
    /*
    | **Index** | **Name**   | **Setting** | **What it means in your code**                               |
    | --------- | ---------- | ----------- | ------------------------------------------------------------ |
    | `[0]`     | **stdin**  | `'ignore'`  | The child process won't listen for any keyboard input or data from your main script. |
    | `[1]`     | **stdout** | `'pipe'`    | The main script "pipes" the child's output. You can listen to this to get the video data or progress logs. |
    | `[2]`     | **stderr** | `'pipe'`    | Errors or warning messages from the child are also piped back to you for handling. |
    */
    const child = spawn(ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];

    if (captureStdout) {
      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    }
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => subscriber.error(err));
    child.on('exit', (code) => {
      if (code === 0) {
        subscriber.next(
          captureStdout ? Buffer.concat(stdoutChunks).toString() : ''
        );
        return subscriber.complete();
      }

      subscriber.error(
        new Error(
          `${ytDlpBin} exited with code ${code}: ${Buffer.concat(stderrChunks)}`
        )
      );
    });

    return () => {
      if (!child.killed) {
        child.kill();
      }
    };
  });
}

module.exports = {
  runYtDlp,
  listSubscriptionFiles,
  fileExists,
  isPreviousInstanceRunning,
};
