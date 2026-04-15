'use strict';

const {
  readdir,
  readFile,
  access,
  mkdir,
  writeFile,
  unlink,
} = require('fs/promises');
const { join, parse, dirname, delimiter } = require('path');
const process = require('process');
const { findProcess } = require('find-process/lib/find_process');
const { spawn } = require('child_process');
const {
  Observable,
  of,
  from,
  defer,
  forkJoin,
  throwError,
  EMPTY,
} = require('rxjs');
const {
  switchMap,
  concatMap,
  map,
  mapTo,
  catchError,
  last,
  timeout,
  tap,
} = require('rxjs/operators');
const moment = require('moment');

const { path } = require('./const');

/**
 * Log a message to console if not in quiet mode
 * @param {string} message - The message to log
 * @param {boolean} quiet - If true, suppress output
 * @returns {void}
 */
function log(message, quiet = false) {
  if (quiet) {
    return;
  }

  console.log(message);
}

/**
 * check if a process with the given PID is still running
 * @param {string} lockFilePath path to the lock file
 * @returns {Promise<boolean>} true if the process is running, false otherwise
 */
const isPreviousInstanceRunning = (lockFilePath) =>
  readFile(lockFilePath, 'utf8')
    .then(JSON.parse)
    .then((/** @type {LockFileContent} */ lockFileContent) =>
      findProcess({ pid: lockFileContent.pid })
    ) /** @param {unknown[]} results */
    .then((results) => !!results[0]);

/**
 * check if a file or directory exists
 * @param {string} filePath path to check
 * @returns {Observable<boolean>} Observable emitting true if the path is accessible
 */
const fileExists = (filePath) =>
  /** @type {Observable<boolean>} */ (
    defer(() => access(filePath)).pipe(
      mapTo(true),
      catchError(() => of(false))
    )
  );

/**
 * list subscription files, emit sequentially
 * @param {string} readPath directory containing subscription files
 * @return {Observable<Dirent>} Observable of subscription files
 */
const listSubscriptionFiles = (readPath) =>
  /** @type {Observable<Dirent>} */ (
    defer(() => readdir(readPath, { withFileTypes: true })).pipe(
      map((fileDirents) =>
        fileDirents.filter(({ name }) => /.*\.json$/i.test(name))
      ),
      concatMap(from)
    )
  );

/**
 * spawn yt-dlp as a child process
 * @param {string} ytDlpBin path to yt-dlp binary
 * @param {string[]} args arguments to pass to yt-dlp
 * @param {boolean} captureStdout if true, emit captured stdout on success
 * @param {boolean} quiet if true, log stdout and stderr
 * @returns {Observable<string>} emits stdout (if captured) on success, or an error on failure
 */
const runYtDlp = (ytDlpBin, args, captureStdout, quiet) => {
  const nodeDirPath = dirname(process.execPath);
  return /** @type {Observable<string>} */ new Observable((subscriber) => {
    /*
    | **Index** | **Name**   | **Setting** | **What it means in your code**                               |
    | --------- | ---------- | ----------- | ------------------------------------------------------------ |
    | `[0]`     | **stdin**  | `'ignore'`  | The child process won't listen for any keyboard input or data from your main script. |
    | `[1]`     | **stdout** | `'pipe'`    | The main script "pipes" the child's output. You can listen to this to get the video data or progress logs. |
    | `[2]`     | **stderr** | `'pipe'`    | Errors or warning messages from the child are also piped back to you for handling. |
    */
    const child = spawn(
      ytDlpBin,
      [...args, ...(quiet ? ['--quiet'] : ['--verbose', '--progress'])],
      {
        env: {
          ...process.env,
          PATH: `${nodeDirPath}${delimiter}${process.env.PATH}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const stdoutChunks = [];
    const stderrChunks = [];

    if (captureStdout) {
      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    }

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);

      if (quiet) {
        return;
      }

      process.stdout.write(
        `\r\x1b[K${chunk.toString().replace(/\r?\n|\r/g, '\x1b[K\r')}`
      );
    });

    child.on('error', (err) => {
      if (!quiet) {
        process.stdout.write('\r\x1b[K');
      }

      subscriber.error(err);
    });
    child.on('exit', (code) => {
      if (!quiet) {
        process.stdout.write('\r\x1b[K');
      }

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
      if (child.killed) {
        return;
      }

      child.kill();
    };
  });
};

/**
 * Initialize the working directory structure
 * @param {string} cwd working directory path
 * @param {string} downloadDirPath path to download directory
 * @param {string} subscriptionDirPath path to subscription directory
 * @param {string} lockFilePath path to lock file
 * @returns {Observable<void>} Observable that completes when initialization is done
 */
const initializeWorkingDirectory = (
  cwd,
  downloadDirPath,
  subscriptionDirPath,
  lockFilePath
) =>
  /** @type {Observable<void>} */ (
    forkJoin([
      fileExists(cwd),
      fileExists(lockFilePath),
      fileExists(downloadDirPath),
      fileExists(subscriptionDirPath),
    ]).pipe(
      switchMap(
        ([
          cwdExists,
          lockFileExists,
          downloadDirExists,
          subscriptionDirExists,
        ]) => {
          if (!cwdExists) {
            return throwError(new Error(`Directory "${cwd}" does not exist.`));
          }

          if (!lockFileExists) {
            return of([
              lockFileExists,
              undefined,
              downloadDirExists,
              subscriptionDirExists,
            ]);
          }

          return isPreviousInstanceRunning(lockFilePath).then((isLocked) => [
            lockFileExists,
            isLocked,
            downloadDirExists,
            subscriptionDirExists,
          ]);
        }
      ),
      switchMap(
        ([
          lockFileExists,
          isLocked,
          downloadDirExists,
          subscriptionDirExists,
        ]) => {
          if (isLocked) {
            return throwError(
              new Error(
                `Another instance is already running at directory "${cwd}".`
              )
            );
          }

          const downloadDirPath$ = downloadDirExists
            ? of(null)
            : defer(() => mkdir(downloadDirPath, { recursive: true }));

          const subscriptionDirPath$ = subscriptionDirExists
            ? of(null)
            : defer(() => mkdir(subscriptionDirPath, { recursive: true }));

          const lockFile = JSON.stringify(
            { pid: process.pid, startedAt: new Date().toISOString() },
            null,
            2
          );
          const lockFile$ = lockFileExists
            ? defer(() =>
                unlink(lockFilePath).then(() =>
                  writeFile(lockFilePath, lockFile)
                )
              )
            : defer(() => writeFile(lockFilePath, lockFile));

          return forkJoin([downloadDirPath$, subscriptionDirPath$, lockFile$]);
        }
      ),
      switchMap(() => {
        const subscriptionSample = {
          url: 'https://www.youtube.com/@ChannelName/videos',
          dateAfter: 'now-1month',
          maxDurationInSecond: 1800,
        };
        return defer(() =>
          writeFile(
            join(subscriptionDirPath, 'sample.json'),
            JSON.stringify(subscriptionSample, null, 2)
          )
        );
      })
    )
  );

/**
 * Parses the dateAfter property from a subscription file content and returns the corresponding moment object
 * @param {SubscriptionFileContent} subscription - Subscription file content object containing the dateAfter property
 * @returns {moment.Moment|undefined} Moment object representing the maximum upload moment, or null if invalid
 */
const getMinUploadMoment = (subscription) => {
  const { dateAfter } = subscription;

  if (!dateAfter) {
    return;
  }

  const match = dateAfter.match(/^now-(\d+)(day|week|month|year)s?$/i);

  if (!match) {
    return;
  }

  const [_, amount, unit] = match;

  if (!amount || !unit) {
    return;
  }

  const minUploadMoment = moment().subtract(
    parseInt(amount, 10),
    unit.toLowerCase()
  );

  if (!minUploadMoment.isValid()) {
    return;
  }

  return minUploadMoment;
};

/**
 * Validates and returns the maximum duration in seconds from subscription file content
 * @param {SubscriptionFileContent} subscription - Subscription file content object containing the maxDurationInSecond property
 * @returns {number|undefined} The validated duration in seconds, or null if invalid
 */
const getMaxDurationInSecond = (subscription) => {
  const { maxDurationInSecond } = subscription;

  if (!Number.isInteger(maxDurationInSecond)) {
    return;
  }

  return maxDurationInSecond;
};

/**
 * Removes videos from the download directory that were uploaded after the specified max upload moment
 * @param {string} subscriptionDownloadDirPath - Path to the subscription download directory
 * @param {moment.Moment} minUploadMoment - The maximum upload moment after which videos should be removed
 * @returns {Observable<void>} Observable that completes when expired videos are removed
 */
const removeExpiredVideos = (subscriptionDownloadDirPath, minUploadMoment) =>
  /** @type {Observable<void>} */ (
    defer(() =>
      readdir(subscriptionDownloadDirPath)
        .then((fileNames) =>
          fileNames.filter(
            (fileName) =>
              fileName.endsWith('.info.json') && !fileName.includes('[PL')
          )
        )
        .then((videoInfoFileNames) =>
          Promise.all(
            videoInfoFileNames.reduce((acc, videoInfoFileName) => {
              const videoInfoFilePath = join(
                subscriptionDownloadDirPath,
                videoInfoFileName
              );

              return [
                ...acc,
                readFile(videoInfoFilePath, 'utf8')
                  .then(JSON.parse)
                  .then(({ timestamp }) => {
                    if (moment.unix(timestamp).isAfter(minUploadMoment)) {
                      return null;
                    }

                    const videoFilePath = videoInfoFilePath.replace(
                      /\.info\.json$/,
                      '.mp4'
                    );

                    return Promise.all([
                      unlink(videoFilePath).catch(() => {}),
                      unlink(videoInfoFilePath),
                    ]);
                  }),
              ];
            }, [])
          )
        )
    )
  );

/**
 * Checks if a video ID exists in the yt-dlp archive file, which tracks previously downloaded videos.
 * Reads the archive file and searches for the specified video ID in the format "youtube <videoId>".
 *
 * @param {string} archiveFilePath - Path to the yt-dlp archive file
 * @param {string} videoId - YouTube video ID to check for
 * @returns {Observable<boolean>} Observable emitting true if the video ID exists in the archive, false otherwise
 */
const isVideoFilePreviouslyDownloaded = (archiveFilePath, videoId) =>
  /** @type {Observable<boolean>} */ (
    fileExists(archiveFilePath).pipe(
      switchMap((archiveFileExists) => {
        if (!archiveFileExists) {
          return of(false);
        }

        return readFile(archiveFilePath, 'utf8').then((ytDlpArchiveDump) => {
          if (!ytDlpArchiveDump) {
            return false;
          }

          const videoIdRegex = /^youtube\s+([\w-]+)$/;

          /**
           * @example ytDlpArchiveDump
           * // youtube Loremipsumd
           * // youtube olorsitamet
           * // youtube consectetur
           * // youtube adipisicing
           */
          const videoIds = ytDlpArchiveDump
            .toString()
            .split('\n')
            .reduce((acc, item) => {
              if (!item) {
                return acc;
              }

              if (!videoIdRegex.test(item)) {
                return acc;
              }

              const [_, _videoId] = item.match(videoIdRegex);

              if (!_videoId) {
                return acc;
              }

              return [...acc, _videoId];
            }, []);

          if (!videoIds.length) {
            return false;
          }

          return new Set(videoIds).has(videoId);
        });
      })
    )
  );

/**
 * Downloads a single video using yt-dlp
 * @param {string} ytDlpBinPath - Path to the yt-dlp executable binary
 * @param {string} subscriptionDownloadDirPath - Path to the download directory
 * @param {VideoMetadata} video - Video object
 * @param {boolean} quiet - If true, suppress output
 * @returns {Observable<string>} Observable emitting stdout on success
 */
const downloadVideo = (
  ytDlpBinPath,
  subscriptionDownloadDirPath,
  video,
  quiet
) => {
  const { id, title, duration } = video;

  const outputFileNameTemplate = join(
    subscriptionDownloadDirPath,
    '%(title)s [%(id)s].%(ext)s'
  );
  const archiveFilePath = join(subscriptionDownloadDirPath, path.ytDlpArchive);

  return /** @type {Observable<string>} */ isVideoFilePreviouslyDownloaded(
    archiveFilePath,
    id
  ).pipe(
    switchMap((_isVideoFilePreviouslyDownloaded) => {
      // if the video is previously downloaded
      if (_isVideoFilePreviouslyDownloaded) {
        // then skip the video
        log(`🟢 Skipping previously downloaded video: ${title}`, quiet);
        return of([_isVideoFilePreviouslyDownloaded]);
      }

      const downloadVideo$ = runYtDlp(
        ytDlpBinPath,
        [
          id,
          '-o',
          outputFileNameTemplate,
          '--download-archive',
          archiveFilePath,
          '--no-overwrites',
          '--write-info-json',
          // use Node.js to execute the JavaScript code required to solve YouTube's "challenges"
          '--js-runtimes',
          'node',
          // automatically download and update the JavaScript "challenge solver" scripts directly from the official yt-dlp-ejs GitHub repository
          '--remote-components',
          'ejs:github',
          // sensible format: best mp4 up to 1080p, or best available
          '-f',
          'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
          '--merge-output-format',
          'mp4',
          '--ignore-errors',
        ],
        false,
        quiet
      );

      // if the video is not previously downloaded,
      // then download the video
      log(`📥 Downloading video: ${title}`, quiet);
      return forkJoin([of(_isVideoFilePreviouslyDownloaded), downloadVideo$]);
    }),
    switchMap(([_isVideoFilePreviouslyDownloaded]) =>
      forkJoin([
        of(_isVideoFilePreviouslyDownloaded),
        isVideoFilePreviouslyDownloaded(archiveFilePath, id),
      ])
    ),
    timeout(duration * 1000),
    catchError((error) => {
      log(`⚠️ Failed to download. Error: ${error}`);
      return EMPTY;
    }),
    tap(([_isVideoFilePreviouslyDownloaded, _isVideoFileDownloaded]) => {
      if (_isVideoFilePreviouslyDownloaded || !_isVideoFileDownloaded) {
        return;
      }

      log('✨ Download completed');
    })
  );
};

/**
 * Downloads multiple videos sequentially using yt-dlp
 * @param {string} ytDlpBinPath - Path to the yt-dlp executable binary
 * @param {string} subscriptionDownloadDirPath - Path to the download directory
 * @param {VideoMetadata[]} videos - Array of video objects
 * @param {boolean} quiet - If true, suppress output
 * @returns {Observable<string>} Observable that completes when all videos are downloaded
 */
const downloadVideos = (
  ytDlpBinPath,
  subscriptionDownloadDirPath,
  videos,
  quiet
) =>
  /** @type {Observable<string>} */ (
    of(...videos).pipe(
      concatMap((video) =>
        downloadVideo(ytDlpBinPath, subscriptionDownloadDirPath, video, quiet)
      ),
      last()
    )
  );

/**
 * Downloads videos for a single subscription using yt-dlp.
 * Reads the subscription JSON file, creates the download directory if needed,
 * removes expired videos based on dateAfter configuration, and then downloads
 * new videos using yt-dlp with specified options.
 *
 * @param {string} subscriptionFilePath - Path to the subscription JSON file
 * @param {string} subscriptionDownloadDirPath - Path to the directory where videos will be downloaded
 * @param {string} ytDlpBinPath - Path to the yt-dlp executable binary
 * @param {boolean} quiet - If true, suppress yt-dlp output (use --quiet flag)
 * @returns {Observable<void>} Observable that completes when subscription processing is done
 * @throws {Error} If subscription file cannot be parsed, invalid URL is found, or directory creation fails
 */
const processSubscription = (
  subscriptionFilePath,
  subscriptionDownloadDirPath,
  ytDlpBinPath,
  quiet
) =>
  /** @type {Observable<void>} */ (
    forkJoin([
      readFile(subscriptionFilePath, 'utf8'),
      fileExists(subscriptionDownloadDirPath),
    ]).pipe(
      switchMap(([subscriptionFile, subscriptionDownloadDirExists]) => {
        log(`\x1b[1mSubscription ${subscriptionFilePath}\x1b[0m`, quiet);

        /** @type {SubscriptionFileContent} */
        let subscription;
        try {
          subscription = JSON.parse(subscriptionFile);
        } catch (error) {
          return throwError(
            `Invalid subscription file: ${subscriptionFilePath}. Error: ${error}`
          );
        }

        const { url } = subscription;

        if (!url) {
          return throwError(
            `Invalid URL found in subscription file: ${subscriptionFilePath}`
          );
        }

        return subscriptionDownloadDirExists
          ? of(subscription)
          : defer(() =>
              mkdir(subscriptionDownloadDirPath, { recursive: true }).then(
                () => subscription
              )
            );
      }),
      switchMap((subscription) => {
        const { url } = subscription;
        const minUploadMoment = getMinUploadMoment(subscription) || null;
        const maxDurationInSecond =
          getMaxDurationInSecond(subscription) || null;

        const playlistDump$ = runYtDlp(
          ytDlpBinPath,
          [
            url,
            '--dump-json',
            // only look at the list level
            '--flat-playlist',
            // make best-effort to parse the upload date
            '--extractor-args',
            'youtubetab:approximate_date',
          ],
          true,
          quiet
        );

        return forkJoin([
          of(minUploadMoment),
          of(maxDurationInSecond),
          playlistDump$,
          minUploadMoment
            ? removeExpiredVideos(subscriptionDownloadDirPath, minUploadMoment)
            : of(null),
        ]);
      }),
      switchMap(([minUploadMoment, maxDurationInSecond, playlistDump]) => {
        const videos = playlistDump.split('\n').reduce(
          (acc, item) => {
            if (!item) {
              return acc;
            }

            /** @type VideoMetadata */
            let video;
            try {
              video = JSON.parse(item);
            } catch (error) {
              return acc;
            }

            const { id, title, duration, upload_date } = video;

            if (!id || !duration) {
              return acc;
            }

            if (!upload_date) {
              log(
                `⚠️ Warning: upload date is missing from video: ${title}.`,
                quiet
              );
            }

            if (
              minUploadMoment &&
              upload_date &&
              moment(upload_date, 'YYYYMMDD').isBefore(minUploadMoment)
            ) {
              return acc;
            }

            if (maxDurationInSecond && duration > maxDurationInSecond) {
              return acc;
            }

            return id ? [...acc, { id, title, duration }] : acc;
          },
          /** @type Partial<VideoMetadata>[] */
          []
        );

        if (!videos.length) {
          log('⚠️ Warning: no matching video found.', quiet);
          return EMPTY;
        }

        return downloadVideos(
          ytDlpBinPath,
          subscriptionDownloadDirPath,
          videos,
          quiet
        );
      }),
      catchError((error) => {
        if (!quiet) {
          console.error(
            `❌ Unable to process subscription "${subscriptionFilePath}". Error: ${error}`
          );
        }
        return EMPTY;
      })
    )
  );

/**
 * Downloads videos from all subscription files in the subscription directory.
 * Validates that required directories and binaries exist, creates/updates a lock file
 * to prevent concurrent instances, and processes each subscription file by downloading
 * videos using yt-dlp.
 *
 * @param {string} cwd - The current working directory path
 * @param {string} downloadDirPath - Path to the download directory
 * @param {string} subscriptionDirPath - Path to the subscription directory containing JSON files
 * @param {string} lockFilePath - Path to the lock file for preventing concurrent runs
 * @param {string} ytDlpBinPath - Path to the yt-dlp executable binary
 * @param {boolean} quiet - If true, suppress yt-dlp output (use --quiet flag)
 * @returns {Observable<void>} Observable that completes when all subscriptions are processed
 * @throws {Error} If required directories or binary don't exist, or if another instance is running
 */
const downloadPlaylists = (
  cwd,
  downloadDirPath,
  subscriptionDirPath,
  lockFilePath,
  ytDlpBinPath,
  quiet
) =>
  /** @type {Observable<void>} */ (
    forkJoin([
      fileExists(cwd),
      fileExists(lockFilePath),
      fileExists(downloadDirPath),
      fileExists(subscriptionDirPath),
      fileExists(ytDlpBinPath),
    ]).pipe(
      switchMap(
        ([
          cwdExists,
          lockFileExists,
          downloadDirExists,
          subscriptionDirExists,
          ytDlpBinExists,
        ]) => {
          if (!cwdExists) {
            return throwError(new Error(`Directory "${cwd}" does not exist.`));
          }

          if (!downloadDirExists) {
            return throwError(
              new Error(
                `Directory "${downloadDirPath}" does not exist. Run with --init first.`
              )
            );
          }

          if (!subscriptionDirExists) {
            return throwError(
              new Error(
                `Directory "${subscriptionDirPath}" does not exist. Run with --init first.`
              )
            );
          }

          if (!ytDlpBinExists) {
            return throwError(
              new Error(
                `Binary yt-dlp "${ytDlpBinPath}" does not exist. Specify with -Y /path/to/yt-dlp`
              )
            );
          }

          if (!lockFileExists) {
            return of([lockFileExists, undefined]);
          }

          return isPreviousInstanceRunning(lockFilePath).then((isLocked) => [
            lockFileExists,
            isLocked,
          ]);
        }
      ),
      switchMap(([lockFileExists, isLocked]) => {
        if (isLocked) {
          return throwError(
            new Error(
              `Another instance is already running at directory "${cwd}".`
            )
          );
        }

        const lock = JSON.stringify(
          { pid: process.pid, startedAt: new Date().toISOString() },
          null,
          2
        );

        const lockFile$ = lockFileExists
          ? defer(() =>
              unlink(lockFilePath).then(() => writeFile(lockFilePath, lock))
            )
          : defer(() => writeFile(lockFilePath, lock));

        return lockFile$;
      }),
      switchMap(() => listSubscriptionFiles(subscriptionDirPath)),
      concatMap(({ name }) =>
        processSubscription(
          join(subscriptionDirPath, name),
          join(downloadDirPath, parse(name).name),
          ytDlpBinPath,
          quiet
        )
      )
    )
  );

module.exports = {
  initializeWorkingDirectory,
  downloadPlaylists,
};
