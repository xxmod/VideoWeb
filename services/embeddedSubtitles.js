const { execFile } = require('child_process');
const path = require('path');

// ── Locate ffmpeg binary ─────────────────────────────────────────────────────

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = 'ffmpeg'; // fallback to system PATH
}

const TEXT_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text',
  'microdvd', 'realtext', 'subviewer', 'subviewer1', 'sami',
]);

const LANGUAGE_MAP = {
  zho: '简体中文', chi: '中文', cmn: '普通话',
  eng: 'English', jpn: '日本語', kor: '한국어',
  fra: 'Français', fre: 'Français',
  deu: 'Deutsch', ger: 'Deutsch',
  spa: 'Español', ita: 'Italiano', por: 'Português',
  rus: 'Русский', ara: 'العربية',
  hin: 'हिन्दी', tha: 'ไทย', vie: 'Tiếng Việt',
  und: '未知语言',
};

// ── Probe embedded subtitle streams ──────────────────────────────────────────

function probeSubtitles(videoPath) {
  return new Promise((resolve) => {
    // Use ffmpeg -i to list streams (outputs to stderr)
    execFile(ffmpegPath, ['-i', videoPath, '-hide_banner'], { timeout: 15000 }, (err, stdout, stderr) => {
      // ffmpeg -i always exits with error (no output specified), that's normal
      const output = (stderr || '') + (stdout || '');
      const subtitles = parseStreams(output);
      resolve(subtitles);
    });
  });
}

function parseStreams(output) {
  const lines = output.split(/\r?\n/);
  const subtitles = [];
  let subtitleIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: Stream #0:2(eng): Subtitle: subrip (default)
    // or:    Stream #0:2: Subtitle: ass
    const m = line.match(/Stream\s+#(\d+):(\d+)(?:\(([a-z]{2,3})\))?\s*:\s*Subtitle:\s*(\S+)/i);
    if (!m) continue;

    const streamIndex = parseInt(m[2]);
    const langCode = m[3] || 'und';
    const codec = m[4].toLowerCase();
    const isDefault = /\(default\)/i.test(line);
    const isForced = /\(forced\)/i.test(line);
    const isText = TEXT_CODECS.has(codec);

    // Look for title in next few metadata lines
    let title = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const tm = lines[j].match(/^\s+title\s*:\s*(.+)/i);
      if (tm) { title = tm[1].trim(); break; }
      // Stop if we hit another stream line
      if (/^\s*Stream\s+#/.test(lines[j])) break;
    }

    // Build label
    const langName = LANGUAGE_MAP[langCode] || langCode;
    let label = title || langName;
    if (title && title.toLowerCase() !== langName.toLowerCase()) {
      label = `${langName} - ${title}`;
    }
    label += ` [${codec.toUpperCase()}]`;
    if (isDefault) label += ' (默认)';
    if (isForced) label += ' (强制)';
    if (!isText) label += ' (图形)';

    subtitles.push({
      index: subtitleIdx,
      streamIndex,
      codec,
      language: langCode,
      langName,
      title,
      label,
      isDefault,
      isForced,
      isText,
    });
    subtitleIdx++;
  }

  return subtitles;
}

// ── Extract embedded subtitle to WebVTT ──────────────────────────────────────

function extractSubtitle(videoPath, subtitleIndex) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-map', `0:s:${subtitleIndex}`,
      '-f', 'webvtt',
      '-v', 'quiet',
      'pipe:1',
    ];

    const proc = execFile(ffmpegPath, args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000,
      encoding: 'utf-8',
    }, (err, stdout) => {
      if (err) return reject(new Error(`提取字幕失败: ${err.message}`));
      if (!stdout || stdout.trim().length === 0) return reject(new Error('字幕内容为空'));
      resolve(stdout);
    });
  });
}

// ── Check if ffmpeg is available ─────────────────────────────────────────────

let _ffmpegAvailable = null;

function checkFfmpeg() {
  if (_ffmpegAvailable !== null) return Promise.resolve(_ffmpegAvailable);
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-version'], { timeout: 5000 }, (err) => {
      _ffmpegAvailable = !err;
      if (!_ffmpegAvailable) {
        console.warn('ffmpeg 不可用，内嵌字幕功能已禁用');
      }
      resolve(_ffmpegAvailable);
    });
  });
}

module.exports = { probeSubtitles, extractSubtitle, checkFfmpeg };
