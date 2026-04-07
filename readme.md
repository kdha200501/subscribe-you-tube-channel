## Description

A CLI tool to download videos from YouTube channels and playlists using `yt-dlp`. It:

- saves videos as `mp4` files
- groups videos from the same subscription into a sub-folder
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

Find where it's installed:

```shell
$ which yt-dlp
```

`yt-dlp` will automatically use `ffmpeg` if available for merging formats. Install `ffmpeg` for best results:

```shell
$ brew install ffmpeg
# or
$ sudo apt install ffmpeg
```



## Usage

### Installation

```shell
$ npm i -g grab-you-tube-playlist
$ mkdir my-youtube-downloads
$ cd my-youtube-downloads
$ grab-you-tube-playlist -i
```

### Manage subscriptions

Edit the sample subscription file with a real YouTube channel or playlist URL:

```shell
$ nano subscriptions/sample.json
```

Example subscription file:

```json
{
  "url": "https://www.youtube.com/@ChannelName/videos",
  "maxVideos": 10
}
```

Add more subscriptions by creating additional JSON files:

```shell
$ nano subscriptions/another-channel.json
```

### Run

```shell
$ grab-you-tube-playlist -Y /path/to/yt-dlp
```

### Options

```shell
$ grab-you-tube-playlist -h
Usage: grab-you-tube-playlist [options]

Options:
  --version                 Show version number                        [boolean]
  -d, --directory           Specify the working directory, defaults to cwd
                                                                        [string]
  -i, --init                Initialize the working directory           [boolean]
  -D, --download-directory  Specify the download directory, defaults to
                            downloads folder under the working directory[string]
  -Y, --yt-dlp-bin          Specify the path to yt-dlp binary          [string]
  -q, --quiet               Do not output to stdout or stderr          [boolean]
  -h, --help                Show help                                  [boolean]
```

### Subscription file format

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | YouTube channel, playlist, or video URL |
| `maxVideos` | number (optional) | Max number of recent videos to download |

### Run from crontab

```shell
$ sudo crontab -e
```

Insert the following (adjust paths and schedule):

```
min hr1,hr2 * * * grab-you-tube-playlist -d /path/to/working/directory -Y /path/to/yt-dlp >/dev/null 2>&1
```