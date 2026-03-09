# VideoWeb

本地影视媒体库播放器，提供电影与电视剧浏览、NFO 元数据解析、封面与字幕识别、在线播放、观看进度管理等功能。

项目采用 Node.js + Express 提供后端 API，并直接托管前端静态页面（无前端构建步骤）。

## 功能概览

- 电影与电视剧双库扫描
- 解析 `movie.nfo` / `tvshow.nfo` / `season.nfo` / 剧集 NFO
- 识别常见海报与背景图（poster/fanart/banner/thumb/logo 等）
- 外挂字幕识别与转换（SRT/ASS/SSA/VTT -> WebVTT）
- 内嵌字幕探测与文本字幕提取（依赖 ffmpeg）
- 视频流播放（支持 HTTP Range）
- 登录与多用户管理（管理员/普通用户）
- 观看进度记录、继续观看、标记已看
- 自动检测媒体目录变化并定时重扫

## 实际目录结构

```text
VideoWeb/
├── server.js
├── config.js
├── settings.json
├── movie-cache.json
├── package.json
├── routes/
│   ├── auth.js
│   ├── movies.js
│   └── teleplays.js
├── services/
│   ├── scanner.js
│   ├── teleplayScanner.js
│   ├── nfoParser.js
│   ├── subtitleService.js
│   ├── embeddedSubtitles.js
│   ├── imageCache.js
│   ├── cacheService.js
│   └── userService.js
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js
        └── player.js
```

## 运行要求

- Node.js 18+（建议 LTS）
- Windows / Linux / macOS
- 可选：`ffmpeg`（用于内嵌字幕功能）

> 项目已包含 `ffmpeg-static` 依赖，通常无需手动安装；若二进制不可用，会自动回退系统 `ffmpeg`。

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 启动服务

```bash
npm start
```

开发模式（Node 监听重启）：

```bash
npm run dev
```

3. 打开浏览器

- 默认地址：`http://localhost:48233`

首次启动时会进入初始化界面：

- 创建管理员账户（若系统中还没有用户）
- 配置电影目录和/或电视剧目录
- 设置端口

## 配置说明

配置来源优先级：环境变量 > `settings.json` > 默认值。

默认配置（见 `config.js`）：

- `port`: `48233`
- `movieDir`: 空字符串
- `teleplayDir`: 空字符串

可用环境变量：

- `PORT`
- `MOVIE_DIR`
- `TELEPLAY_DIR`

Windows 示例：

```bash
set PORT=48233
set MOVIE_DIR=Z:\movie&teleplay\movie
set TELEPLAY_DIR=Z:\movie&teleplay\teleplay
npm start
```

## 鉴权与权限

- 使用请求头 `x-token` 传递登录令牌
- 令牌有效期默认 7 天（服务重启后会失效）
- 有用户存在时，大多数业务 API 需要登录
- 管理员权限接口：重扫、系统设置、用户管理

## API 速览

### 系统

- `GET /api/settings` 获取当前配置与初始化状态
- `POST /api/settings` 保存配置并触发扫描（管理员）
- `POST /api/rescan` 手动重扫（管理员）

### 认证与用户

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/create-admin`（仅首个管理员）
- `GET /api/auth/users`（管理员）
- `POST /api/auth/users`（管理员）
- `DELETE /api/auth/users/:username`（管理员）
- `POST /api/auth/users/:username/reset-password`（管理员）

### 观看进度

- `GET /api/auth/watch-data`
- `POST /api/auth/watch-progress`
- `POST /api/auth/mark-watched`
- `POST /api/auth/unmark-watched`

### 电影

- `GET /api/movies`
- `GET /api/movies/:id`
- `GET /api/movies/:id/image/:type`
- `GET /api/movies/:id/stream`
- `GET /api/movies/:id/subtitle/:file`
- `GET /api/movies/:id/embedded-subtitle/:index`

### 电视剧

- `GET /api/teleplays`
- `GET /api/teleplays/:id`
- `GET /api/teleplays/:id/image/:type`
- `GET /api/teleplays/:id/season/:snum/poster`
- `GET /api/teleplays/:id/season/:snum/episode/:eid/thumb`
- `GET /api/teleplays/:id/season/:snum/episode/:eid/stream`
- `GET /api/teleplays/:id/season/:snum/episode/:eid/subtitle/:file`
- `GET /api/teleplays/:id/season/:snum/episode/:eid/embedded-subtitle/:index`

## 媒体库命名建议

### 电影

```text
电影名 (年份)/
├── movie.nfo
├── poster.jpg
├── fanart.jpg
├── 电影名 (年份).mkv
├── 电影名 (年份).eng.srt
└── 电影名 (年份).zho.ass
```

### 电视剧

```text
剧名 (年份)/
├── tvshow.nfo
├── poster.jpg
├── fanart.jpg
├── Season 01/
│   ├── season.nfo
│   ├── S01E01.mkv
│   ├── S01E01.nfo
│   └── S01E01.eng.srt
└── Season 02/
    └── ...
```

## 字幕语言后缀

推荐使用 `文件名.langcode.ext`，例如：`movie.zho.srt`、`movie.eng.ass`。

常见语言代码：

- `zho` / `chi` / `cmn`：中文
- `eng`：English
- `jpn`：日本語
- `kor`：한국어
- `fra` / `fre`：Français
- `deu` / `ger`：Deutsch
- `spa`：Español
- `ita`：Italiano
- `por`：Português
- `rus`：Русский

## 缓存与数据文件

- `settings.json`: 运行配置
- `movie-cache.json`: 电影扫描缓存
- `teleplay-cache.json`: 电视剧扫描缓存（运行后生成）
- `users.json`: 用户与观看数据（运行后生成）

## 技术栈

- 后端：Node.js, Express, xml2js, sharp
- 前端：原生 HTML / CSS / JavaScript
- 媒体：HTML5 Video, HTTP Range, WebVTT
