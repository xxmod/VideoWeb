const fs = require('fs');
const path = require('path');

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

const LANGUAGE_MAP = {
  zho: '简体中文',
  chi: '中文',
  cmn: '普通话',
  eng: 'English',
  jpn: '日本語',
  kor: '한국어',
  fra: 'Français',
  fre: 'Français',
  deu: 'Deutsch',
  ger: 'Deutsch',
  spa: 'Español',
  ita: 'Italiano',
  por: 'Português',
  rus: 'Русский',
  ara: 'العربية',
  hin: 'हिन्दी',
  tha: 'ไทย',
  vie: 'Tiếng Việt',
  und: '未知语言',
};

/**
 * Detect subtitle files from a file list and extract language info.
 */
function detectSubtitles(files) {
  const subtitles = [];

  for (const file of files) {
    // Skip backups
    if (/\.(bk|bak|backup)$/i.test(file)) continue;

    const ext = path.extname(file).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

    // Parse language code from filename: "name.langcode.ext"
    const baseName = path.parse(file).name; // e.g. "Movie.eng"
    const dotIdx = baseName.lastIndexOf('.');
    let langCode = 'und';
    let langName = LANGUAGE_MAP.und;

    if (dotIdx > 0) {
      const candidate = baseName.substring(dotIdx + 1).toLowerCase();
      if (LANGUAGE_MAP[candidate]) {
        langCode = candidate;
        langName = LANGUAGE_MAP[candidate];
      }
    }

    subtitles.push({
      file,
      format: ext.substring(1),
      langCode,
      langName,
      label: `${langName} (${ext.substring(1).toUpperCase()})`,
    });
  }

  return subtitles;
}

// ── SRT → VTT ────────────────────────────────────────────────────────────────

function convertSrtToVtt(srt) {
  let content = srt.replace(/^\uFEFF/, '');
  // Comma → dot in timestamps
  content = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  // Remove bare sequence numbers
  content = content.replace(/^\d+\s*$/gm, '');
  // Collapse extra blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  return 'WEBVTT\n\n' + content.trim() + '\n';
}

// ── ASS / SSA → VTT ─────────────────────────────────────────────────────────

function convertAssToVtt(ass) {
  let content = ass.replace(/^\uFEFF/, '');
  let vtt = 'WEBVTT\n\n';

  const lines = content.split(/\r?\n/);
  let inEvents = false;
  let formatFields = [];
  let cueIndex = 1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '[Events]') { inEvents = true; continue; }
    if (trimmed.startsWith('[') && trimmed !== '[Events]') { inEvents = false; continue; }
    if (!inEvents) continue;

    if (trimmed.startsWith('Format:')) {
      formatFields = trimmed.substring(7).split(',').map(f => f.trim().toLowerCase());
      continue;
    }

    if (!trimmed.startsWith('Dialogue:')) continue;

    const payload = trimmed.substring(trimmed.indexOf(':') + 1).trim();

    // Split respecting that the last field (text) may contain commas
    const parts = [];
    let cur = '';
    let count = 0;
    for (let i = 0; i < payload.length; i++) {
      if (payload[i] === ',' && count < formatFields.length - 1) {
        parts.push(cur.trim());
        cur = '';
        count++;
      } else {
        cur += payload[i];
      }
    }
    parts.push(cur.trim());

    const fields = {};
    for (let i = 0; i < formatFields.length && i < parts.length; i++) {
      fields[formatFields[i]] = parts[i];
    }

    const start = assTimeToVtt(fields.start);
    const end = assTimeToVtt(fields.end);
    const text = cleanAssText(fields.text || '');

    if (start && end && text) {
      vtt += `${cueIndex}\n${start} --> ${end}\n${text}\n\n`;
      cueIndex++;
    }
  }

  return vtt;
}

function assTimeToVtt(t) {
  if (!t) return null;
  // ASS: H:MM:SS.CC → VTT: HH:MM:SS.MMM
  const m = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4]}0`;
}

function cleanAssText(text) {
  let s = text.replace(/\{[^}]*\}/g, ''); // strip override tags
  s = s.replace(/\\N/g, '\n');
  s = s.replace(/\\n/g, '\n');
  s = s.replace(/\\h/g, ' ');
  return s.trim();
}

// ── Public conversion entry point ────────────────────────────────────────────

function convertSubtitleToVtt(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.vtt': return raw;
    case '.srt': return convertSrtToVtt(raw);
    case '.ass':
    case '.ssa': return convertAssToVtt(raw);
    default:     return raw;
  }
}

module.exports = { detectSubtitles, convertSubtitleToVtt, LANGUAGE_MAP };
