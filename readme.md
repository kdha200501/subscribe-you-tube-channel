## ⚠️ IMPORTANT DISCLAIMER

This project is **experimental and for personal use only**. Use at your own risk. This tool interacts with YouTube's services and may be subject to YouTube's Terms of Service. The authors are not responsible for any issues that may arise from using this tool.

---

## Description

A CLI tool to download videos from YouTube playlists using `yt-dlp`. It:

- saves videos as `mp4` files
- groups videos from the same playlist into a sub-folder
- tracks downloaded videos using yt-dlp's download archive (avoids re-downloading)
- supports limiting the number of videos per subscription



## Prerequisites

This tool requires [yt-dlp](https://github.com/yt-dlp/yt-dlp) to be installed on your system.

```shell
# Install via pip
$ pip install yt-dlp

# Or via homebrew
$ brew install yt-dlp
```

> [!TIP]
>
> Find where it's installed:
>
> ```shell
> $ which yt-dlp
> ```



`yt-dlp` will automatically use `ffmpeg` if available. Install `ffmpeg`:

```shell
$ brew install ffmpeg

# or
$ sudo apt install ffmpeg
```



# Installation
```shell
$ npm i -g subscribe-you-tube-channel

$ mkdir ~/.subscribe-you-tube-channel
$ subscribe-you-tube-channel init -C ~/.subscribe-you-tube-channel
```

### Options

```shell
$ subscribe-you-tube-channel init -h
Initialize the working directory
Usage: subscribe-you-tube-channel init [options]

Options:
  --version        Show version number                                                     [boolean]
  -C, --directory  Specify the working directory
                                                                          [string] [default: <$CWD>]
  -q, --quiet      Do not output to stdout or stderr                      [boolean] [default: false]
  -h, --help       Show help                                                               [boolean]

Examples:
  subscribe-you-tube-channel -C ~/.subscribe-you-tube-channel
```

### Manage subscriptions

Edit the sample subscription file with a real YouTube channel or playlist URL:

```shell
$ vim ~/.subscribe-you-tube-channel/subscriptions/sample.json
```

Example subscription file:

```json
{
  "url": "https://www.youtube.com/@ChannelName/videos",
  "dateAfter": "now-1month",
  "maxDurationInSecond": 1800
}
```

> [!TIP]
>
> The `dateAfter` value follows the  `$ yt-dlp --dateafter` convention
>
> | **Unit**  | **Example**  | **Meaning**               |
> | --------- | ------------ | ------------------------- |
> | **day**   | `now-10days` | Since 10 days ago         |
> | **week**  | `now-2weeks` | Since 14 days ago         |
> | **month** | `now-1month` | Since roughly 30 days ago |
> | **year**  | `now-1year`  | Since 365 days ago        |

> [!TIP]
>
> The `maxDurationInSecond` value is passed to the `$ yt-dlp --match-filter` option with the `duration<=<maxDurationInSecond>` filter
>
> | **Example**      | **Meaning**                         |
> | ----------------- | ----------------------------------- |
> | `1800`            | Only videos shorter than 30 minutes |
> | `3600`            | Only videos shorter than 1 hour   |

Add more subscriptions by creating additional JSON files:

```shell
$ touch ~/.subscribe-you-tube-channel/subscriptions/another-playlist.json
$ vim ~/.subscribe-you-tube-channel/subscriptions/another-playlist.json
```



# Usage

```shell
$ subscribe-you-tube-channel -C ~/.subscribe-you-tube-channel -Y /usr/bin/yt-dlp
```

### Options

```shell
$ subscribe-you-tube-channel -h
subscribe-you-tube-channel

Download playlists from subscriptions
Usage: subscribe-you-tube-channel [options]

Commands:
  subscribe-you-tube-channel init  Initialize the working directory
  subscribe-you-tube-channel       Download playlists from subscriptions                   [default]

Options:
  --version                 Show version number                                            [boolean]
  -C, --directory           Specify the working directory
                                                                          [string] [default: <$CWD>]
  -o, --download-directory  Specify the download directory
                                                                [string] [default: <$CWD/downloads>]
  -Y, --yt-dlp-bin          Specify the path to yt-dlp binary                    [string] [required]
  -q, --quiet               Do not output to stdout or stderr             [boolean] [default: false]
  -h, --help                Show help                                                      [boolean]

Examples:
  subscribe-you-tube-channel -C ~/.subscribe-you-tube-channel -o ~/Videos -Y /usr/bin/yt-dlp
```

### Run from crontab

```shell
$ sudo crontab -e
```

Insert the following (adjust paths and schedule):

```
min hr1,hr2 * * * /bin/bash -l -c '. "/home/pi/.nvm/nvm.sh" && subscribe-you-tube-channel -C /home/pi/.subscribe-you-tube-channel/ -o /home/pi/Downloads/YouTube/ -Y /home/pi/.local/bin/yt-dlp --quiet >/dev/null 2>&1'
```
