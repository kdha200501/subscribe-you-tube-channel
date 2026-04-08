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



## Usage

### Installation

```shell
$ npm i -g grab-you-tube-playlist

$ mkdir ~/.grab-you-tube-playlist
$ grab-you-tube-playlist -i -C ~/.grab-you-tube-playlist
```

### Manage subscriptions

Edit the sample subscription file with a real YouTube channel or playlist URL:

```shell
$ vim ~/.grab-you-tube-playlist/subscriptions/sample.json
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
$ touch ~/.grab-you-tube-playlist/subscriptions/another-playlist.json
$ vim ~/.grab-you-tube-playlist/subscriptions/another-playlist.json
```

### Run

```shell
$ grab-you-tube-playlist -C ~/.grab-you-tube-playlist -Y /usr/bin/yt-dlp
```

### Options

```shell
$ grab-you-tube-playlist -h
Usage: grab-you-tube-playlist [options]

Examples:
  Initialize working directory:
    $ grab-you-tube-playlist -i -C ~/.grab-you-tube-playlist

  Download with custom directories:
    $ grab-you-tube-playlist -C ~/.grab-you-tube-playlist -o ~/Videos -Y
    /usr/bin/yt-dlp

Options:
  --version                 Show version number                        [boolean]
  -C, --directory           Specify the working directory
                                   [string] [default: current working directory]
  -i, --init                Initialize the working directory           [boolean]
  -o, --download-directory  Specify the download directory
   [string] [default: "downloads" directory under the current working directory]
  -Y, --yt-dlp-bin          Specify the path to yt-dlp binary[string] [required]
  -q, --quiet               Do not output to stdout or stderr          [boolean]
  -h, --help                Show help                                  [boolean]
```

### Run from crontab

```shell
$ sudo crontab -e
```

Insert the following (adjust paths and schedule):

```
min hr1,hr2 * * * grab-you-tube-playlist -C ~/.grab-you-tube-playlist -o ~/Videos -Y /usr/bin/yt-dlp >/dev/null 2>&1
```
