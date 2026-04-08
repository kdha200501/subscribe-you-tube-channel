#!/usr/bin/env node

'use strict';

const { unlinkSync, existsSync } = require('fs');
const { unlink, mkdir, readFile, writeFile, readdir } = require('fs/promises');
const { join, parse } = require('path');
const process = require('process');
const yargs = require('yargs');
const { of, throwError, EMPTY, defer, forkJoin, Observable } = require('rxjs');
const { switchMap, concatMap, catchError, map } = require('rxjs/operators');

const { path } = require('./const');
const {
  runYtDlp,
  listSubscriptionFiles,
  fileExists,
  isPreviousInstanceRunning,
} = require('./utils');

/**
 * @type {{i: boolean, C: string, q: boolean, o: string, Y: string}}
 */
const argv = yargs
  .scriptName('grab-you-tube-playlist')
  .usage(
    'Usage: $0 [options]\n\nExamples:\n  Initialize working directory:\n    $ $0 -i -C ~/.grab-you-tube-playlist\n\n  Download with custom directories:\n    $ $0 -C ~/.grab-you-tube-playlist -o ~/Videos -Y /usr/bin/yt-dlp'
  )
  .alias('C', 'directory')
  .nargs('C', 1)
  .string('C')
  .describe('C', 'Specify the working directory')
  .default('C', process.cwd())
  .alias('i', 'init')
  .nargs('i', 0)
  .boolean('i')
  .describe('i', 'Initialize the working directory')
  .alias('o', 'download-directory')
  .nargs('o', 1)
  .string('o')
  .describe('o', 'Specify the download directory')
  .default('o', join(process.cwd(), path.downloads))
  .alias('Y', 'yt-dlp-bin')
  .nargs('Y', 1)
  .string('Y')
  .describe('Y', 'Specify the path to yt-dlp binary')
  .demandOption('Y')
  .alias('q', 'quiet')
  .nargs('q', 0)
  .boolean('q')
  .describe('q', 'Do not output to stdout or stderr')
  .help('h')
  .alias('h', 'help').argv;

const cwd = argv.C;
const lockFilePath = join(cwd, path.lock);
const downloadDirPath = argv.o || join(cwd, path.downloads);
const subscriptionDirPath = join(cwd, path.subscriptions);
const ytDlpBinPath = argv.Y;

/**
 * log error message
 * @param {Error|string} error Error message
 * @returns {undefined}
 */
function logError(error) {
  if (argv.q !== true) {
    console.error(error);
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
 * download videos for a single subscription
 * @param {string} subscriptionFilePath path to subscription file
 * @param {string} subscriptionDownloadDirPath path to subscription download directory
 * @returns {Observable<void>} Observable that completes when subscription processing is done
 */
function processSubscription(
  subscriptionFilePath,
  subscriptionDownloadDirPath
) {
  return forkJoin([
    readFile(subscriptionFilePath),
    fileExists(subscriptionDownloadDirPath),
  ]).pipe(
    switchMap(([subscriptionFile, subscriptionDownloadDirExists]) => {
      let subscription;
      try {
        subscription = JSON.parse(subscriptionFile);
      } catch (error) {
        return throwError(error);
      }

      return subscriptionDownloadDirExists
        ? of(subscription)
        : defer(() =>
            mkdir(subscriptionDownloadDirPath, { recursive: true }).then(
              () => subscription
            )
          );
    }),
    switchMap(({ url, maxVideos }) => {
      if (!url) {
        return throwError(`Invalid URL found in ${subscriptionFilePath}`);
      }

      const outputFileNameTemplate = join(
        subscriptionDownloadDirPath,
        '%(title)s [%(id)s].%(ext)s'
      );
      const archiveFilePath = join(subscriptionDownloadDirPath, '.archive.txt');

      const downloadArgs = [
        url,
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
        ...(argv.q ? ['--quiet'] : ['--progress', '--newline']),
      ];

      // if the number of videos in the download directory is not managed
      if (!Number.isInteger(maxVideos) || maxVideos <= 0) {
        // then download all videos in the playlist
        return runYtDlp(ytDlpBinPath, downloadArgs);
      }

      // if the number of videos in the download directory is managed,
      // then delete old videos before download videos
      log('Fetching playlist dump...');
      const scanArgs = [url, '--dump-json'];
      return runYtDlp(ytDlpBinPath, scanArgs, true).pipe(
        map((playlistDump) => {
          const [videos] = playlistDump.split('\n').reduce(
            ([acc, count], item) => {
              if (!item) {
                return [acc, count];
              }

              try {
                const videoMetaData = JSON.parse(item);
                return videoMetaData.id && videoMetaData.timestamp
                  ? [[...acc, { ...videoMetaData, _index: count }], count + 1]
                  : [acc, count + 1];
              } catch (error) {
                return [acc, count + 1];
              }
            },
            [[], 1]
          );

          // Sort videos by timestamp in descending order
          videos.sort((a, b) => b.timestamp - a.timestamp);

          return videos.slice(0, maxVideos);
        }),
        switchMap((latestVideos) =>
          forkJoin([
            of(latestVideos),
            of(new Set(latestVideos.map(({ id }) => id))),
            readdir(subscriptionDownloadDirPath).then((fileNames) =>
              fileNames.filter(
                (fileName) =>
                  fileName.endsWith('.info.json') && !fileName.includes('[PL')
              )
            ),
          ])
        ),
        switchMap(([latestVideos, latestVideoIdSet, videoInfoFileNames]) =>
          latestVideoIdSet.size
            ? Promise.all(
                videoInfoFileNames.reduce((acc, videoInfoFileName) => {
                  const videoInfoFilePath = join(
                    subscriptionDownloadDirPath,
                    videoInfoFileName
                  );

                  return [
                    ...acc,
                    readFile(videoInfoFilePath, 'utf8')
                      .then(JSON.parse)
                      .then(({ id }) => {
                        if (latestVideoIdSet.has(id)) {
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
              ).then(() => latestVideos)
            : Promise.resolve(latestVideos)
        ),
        switchMap((latestVideos) => {
          if (!latestVideos.length) {
            return EMPTY;
          }

          log(`Downloading latest ${latestVideos.length} video(s)...`);
          return runYtDlp(ytDlpBinPath, [
            ...downloadArgs,
            '--playlist-items',
            latestVideos.map(({ _index }) => _index).join(','),
          ]);
        })
      );
    }),
    catchError((error) => {
      logError(
        `Unable to process subscription "${subscriptionFilePath}". Error: ${error}`
      );
      return EMPTY;
    })
  );
}

const cleanupLock = () => {
  try {
    if (existsSync(lockFilePath)) {
      unlinkSync(lockFilePath);
    }
  } catch (error) {
    logError(`Unable to cleanup lock file. Error: ${error}`);
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

// if the end user wants to initialize the working directory
if (argv.i) {
  // then initialize the working directory
  forkJoin([
    fileExists(cwd),
    fileExists(lockFilePath),
    fileExists(downloadDirPath),
    fileExists(subscriptionDirPath),
  ])
    .pipe(
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
          maxVideos: 10,
        };
        return defer(() =>
          writeFile(
            join(subscriptionDirPath, path.subscriptionSample),
            JSON.stringify(subscriptionSample, null, 2)
          )
        );
      })
    )
    .subscribe({
      complete: () => process.exit(0),
      error: (error) => {
        logError(`Initialize failed with Error: ${error}`);
        process.exit(1);
      },
    });
  return;
}

// if the end user wants to download playlist(s), then
// then download playlist(s)
forkJoin([
  fileExists(cwd),
  fileExists(lockFilePath),
  fileExists(downloadDirPath),
  fileExists(subscriptionDirPath),
  fileExists(ytDlpBinPath),
])
  .pipe(
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
        join(downloadDirPath, parse(name).name)
      )
    )
  )
  .subscribe({
    error: (error) => {
      logError(`Download subscription failed with Error: ${error}`);
      process.exit(1);
    },
  });
