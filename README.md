# VideoWeb - 电影媒体库播放器

基于 Node.js 的本地电影媒体库浏览器与播放器，自动识别 NFO 元数据、封面、字幕等信息。

## 项目结构

```
VideoWeb/
├── backend/                  # 后端 API 服务
│   ├── server.js             # Express 入口
│   ├── config.js             # 配置（电影目录等）
│   ├── routes/movies.js      # API 路由
│   └── services/
│       ├── scanner.js        # 电影目录扫描
│       ├── nfoParser.js      # NFO (XML) 元数据解析
│       └── subtitleService.js # 字幕检测与格式转换
├── frontend/                 # 前端静态页面
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js            # 主应用逻辑（路由、列表、详情）
│       └── player.js         # 视频播放器 + 字幕切换
└── README.md
```

## 功能特性

- **NFO 元数据解析** — 自动读取 `movie.nfo` 中的标题、简介、评分、演员、导演、类型等
- **封面识别** — 支持 poster、fanart、banner、thumb、keyart、clearart、logo 等图片
- **字幕检测** — 识别 `.srt` / `.ass` / `.ssa` / `.vtt` 字幕文件，并根据文件名后缀（如 `.zho`、`.eng`）自动识别语言
- **字幕转换** — 后端自动将 SRT / ASS 格式转换为 WebVTT，浏览器直接渲染
- **视频流** — 支持 HTTP Range 请求，可自由拖动进度条
- **搜索过滤** — 前端实时搜索电影名称
- **响应式设计** — 适配桌面和移动端

## 快速开始

### 1. 配置电影目录

编辑 `backend/config.js`，修改 `movieDir` 为你的电影库路径：

```js
module.exports = {
  port: 3000,
  movieDir: 'Z:\\movie&teleplay\\movie',   // ← 修改为你的路径
};
```

或使用环境变量：
```bash
set MOVIE_DIR=Z:\movie&teleplay\movie
```

### 2. 安装并启动后端

```bash
cd backend
npm install
npm start
```

后端将在 `http://localhost:3000` 启动。

### 3. 访问前端

**方式 A（推荐）：通过后端访问**
直接打开浏览器访问 `http://localhost:3000`，后端会自动提供前端静态文件。

**方式 B：独立运行前端**
```bash
cd frontend
npx serve -l 8080
```
访问 `http://localhost:8080`。若后端不在 3000 端口，需在 `frontend/js/app.js` 中修改 `API_BASE`。

## API 接口

| 方法   | 路径                              | 说明              |
| ------ | --------------------------------- | ----------------- |
| GET    | `/api/movies`                     | 获取电影列表      |
| GET    | `/api/movies/:id`                 | 获取电影详情      |
| GET    | `/api/movies/:id/image/:type`     | 获取封面图片      |
| GET    | `/api/movies/:id/stream`          | 视频流（支持 Range） |
| GET    | `/api/movies/:id/subtitle/:file`  | 获取字幕（自动转 VTT） |
| POST   | `/api/rescan`                     | 重新扫描电影目录  |

## 电影目录结构要求

每部电影一个文件夹，包含视频文件、NFO、封面和字幕：

```
电影名 (年份)/
├── movie.nfo                        # Kodi/Emby 格式的 NFO 元数据
├── poster.jpg                       # 海报
├── fanart.jpg                       # 背景图
├── 电影名 (年份) 1080p.mp4          # 视频文件
├── 电影名 (年份) 1080p.eng.srt      # 英文字幕
└── 电影名 (年份) 1080p.zho.ass      # 中文字幕
```

### 字幕语言代码

文件名中 `.langcode.ext` 格式中的语言编码：

| 代码 | 语言     | 代码 | 语言      |
| ---- | -------- | ---- | --------- |
| zho  | 简体中文 | eng  | English   |
| jpn  | 日本語   | kor  | 한국어    |
| fra  | Français | deu  | Deutsch   |
| spa  | Español  | ita  | Italiano  |
| rus  | Русский  | por  | Português |

## 技术栈

- **后端**: Node.js + Express + xml2js
- **前端**: 原生 HTML / CSS / JavaScript（无构建步骤）
- **视频**: HTML5 Video + WebVTT 字幕
- **字幕**: 服务端 SRT/ASS → VTT 自动转换
