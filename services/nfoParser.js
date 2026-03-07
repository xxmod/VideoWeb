const fs = require('fs');
const xml2js = require('xml2js');

async function parseNfo(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM
  content = content.replace(/^\uFEFF/, '');

  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    trim: true,
  });

  const result = await parser.parseStringPromise(content);
  const data = result.movie || result.episodedetails || result;

  return {
    title: getField(data, 'title'),
    originaltitle: getField(data, 'originaltitle'),
    sorttitle: getField(data, 'sorttitle'),
    rating: parseFloat(getField(data, 'rating')) || null,
    year: parseInt(getField(data, 'year')) || null,
    votes: parseInt(getField(data, 'votes')) || null,
    outline: getField(data, 'outline'),
    plot: getField(data, 'plot'),
    tagline: getField(data, 'tagline'),
    runtime: parseInt(getField(data, 'runtime')) || null,
    mpaa: getField(data, 'mpaa'),
    genres: getArray(data, 'genre'),
    country: getField(data, 'country'),
    studio: getField(data, 'studio'),
    directors: getArray(data, 'director'),
    actors: parseActors(data.actor),
    uniqueIds: parseUniqueIds(data.uniqueid),
  };
}

function getField(data, field) {
  if (!data || data[field] == null) return '';
  const val = data[field];
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val._) return val._;
  if (typeof val === 'number') return String(val);
  return '';
}

function getArray(data, field) {
  if (!data || !data[field]) return [];
  const val = data[field];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map(v => (typeof v === 'string' ? v : v._ || String(v)));
}

function parseActors(actors) {
  if (!actors) return [];
  if (!Array.isArray(actors)) actors = [actors];

  return actors
    .map(a => ({
      name: getField(a, 'name'),
      role: getField(a, 'role'),
      thumb: getField(a, 'thumb'),
      order: parseInt(getField(a, 'order')) || 0,
    }))
    .filter(a => a.name);
}

function parseUniqueIds(ids) {
  if (!ids) return {};
  if (!Array.isArray(ids)) ids = [ids];

  const result = {};
  for (const uid of ids) {
    if (uid && uid.$ && uid.$.type) {
      result[uid.$.type] = uid._ || '';
    }
  }
  return result;
}

module.exports = { parseNfo };
