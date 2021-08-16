#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const exec = require('child_process').exec;
const readline = require('readline');

function makePlaylist(chunk, key) {
  let data = `#EXTM3U
#EXT-X-TARGETDURATION:3
#EXT-X-ALLOW-CACHE:NO
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:1
`;
  if (key) {
    data += `${key}\n`;
  }
  data += `${chunk}
#EXT-X-ENDLIST
`;
  return data;
}

function executeShell(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error !== null) {
        return reject(stderr);
      }
      resolve(stdout);
    })
  });
}

async function fetchChunk(playlist, fileName) {
  let name = `chunk.m3u8`;
  fs.writeFileSync(name, playlist);
  await executeShell(`ffmpeg -protocol_whitelist "crypto,https,file,tls,tcp" -i "${name}" -vn -dn -sn -acodec copy -y "${fileName}"`);
  fs.unlinkSync(name);
}

async function concatPieces(pieces, artist, title) {
  const fileName = makeFilename(artist, title);

  fs.writeFileSync('playlist.txt', pieces.join('\n'));
  await executeShell(`ffmpeg -f concat -safe 0 -i "playlist.txt" -metadata artist="${artist}" -metadata title="${title}" -c copy -y "temp.mp3"`);
  fs.unlinkSync('playlist.txt');
  await executeShell('rm chunk*.mp3');
  fs.renameSync('temp.mp3', fileName);
}

function parseChunks(base, source) {
  console.log('Parsing the playlist...')

  return source
    .split('\n')
    .reduce((result, line) => {
      if (line.includes('#EXT-X-KEY:METHOD')) {
        key = line;
      } else if (line.includes('#EXTINF:')) {
        chunk = `${line}\n`;
      } else if (line.includes('.ts?')) {
        chunk += `${base}${line}`;
        result.push(['' + chunk, '' + key]);

        chunk = '';
        key = '';
      }
      return result;
    }, []);
}

const progressSize = 40;
function progress(total, index) {
  const percent = total / progressSize;
  const done = Math.ceil(index / percent);
  const left = Math.floor((total - index) / percent);
  return `[${'▓'.repeat(done)}${'░'.repeat(left)}]`;
}

function fail(becauseOf) {
  console.log(`Failure: ${becauseOf}`);
  process.exit(1);
}

function makeFilename(artist, title) {
  return `${artist} - ${title}.mp3`;
}

async function main(url, artist, title) {
  try {
    await executeShell('rm playlist*');
  } catch {};

  console.log('Fetching the playlist');
  https.get(url, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
      data += chunk;
    });

    resp.on('end', async () => {
      const [base, ] = url.split('index.m3u8', 2);
      const chunks = parseChunks(base, data);
      const chunksCount = chunks.length;
      console.log(`${chunksCount} chunks found. Fetching:`);

      const fileName = makeFilename(artist, title);

      let pieces = [];

      // Not a forEach to be executed synchronously
      for (let index = 0; index < chunksCount; index++) {
        const [chunk, key] = chunks[index];
        let name = `chunk${index}.mp3`;
        try {
          await fetchChunk(makePlaylist(chunk, key), name);
        } catch (error) {
          fail(`Chunk fetching error "${error}"`);
        }
        process.stdout.write(`Chunk ${index+1} of ${chunksCount} fetched: ` + progress(chunksCount, index) + '      \r');
        pieces.push(`file '${name}'`);

        // Concat every 30 chunks together
        if (index % 30 === 0 || index == chunksCount - 1) {
          await concatPieces(pieces, artist, title);
          pieces = [`file '${fileName}'`];
        }
      };
      console.log(`\nCompleted successfully. Saved to "${fileName}"`);
    });
  }).on('error', (error) => {
    fail(`Unable to fetch URL supplied`);
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '>'
});

rl.question('URL of M3U8 stream: ', (url) => {
  if (!url) fail('Invalid URL');

  rl.question(`Artist: `, (artist = '') => {
    rl.question('Tune title: ', (title = '') => {
      main(url, artist, title);
      rl.close();
    });
  });
});
