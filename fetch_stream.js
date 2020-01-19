#!/usr/bin/env node

var fs = require('fs');
var https = require('https');
const exec = require('child_process').exec;
var args = process.argv.slice(2);

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

function fetchChunk(playlist, fileName) {
  let name = `chunk.m3u8`;
  fs.writeFileSync(name, playlist);
  return executeShell(`ffmpeg -protocol_whitelist "crypto,https,file,tls,tcp" -i "${name}" -vn -dn -sn -acodec copy -y "${fileName}"`)
    .then(() => {
      fs.unlinkSync(name);
    })
    .catch(error => {
      console.log('Error fetching the chunk:', error);
    });
}

function concatPieces(pieces, fileName) {
  fs.writeFileSync('playlist.txt', pieces.join('\n'));
  return executeShell('ffmpeg -f concat -safe 0 -i "playlist.txt" -c copy -y "temp.mp3"')
    .then(() => {
      fs.unlinkSync('playlist.txt');
      executeShell('rm chunk*.mp3');
      fs.renameSync('temp.mp3', fileName);
    });
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

function progress(total, index) {
  let size = 40;
  let percent = total / size;
  let done = Math.ceil(index / percent);
  let left = Math.floor((total - index) / percent);
  return `[${'▓'.repeat(done)}${'░'.repeat(left)}]`;
}

function main(url, title) {
  return executeShell('rm playlist*')
    .catch(error => {})
    .then(() => {
      console.log('Fetching the playlist');
      https.get(url, (resp) => {
        let data = '';

        resp.on('data', (chunk) => {
          data += chunk;
        });

        let name;

        resp.on('end', async () => {
          let key = '';
          let chunk = '';

          let [base, ] = url.split('index.m3u8', 2);

          let chunks = parseChunks(base, data);

          let l = chunks.length;
          console.log(`${l} chunks found. Fetching:`);

          let resultName = `${title}.mp3`;
          let name = resultName;
          let pieces = [];

          for (let index = 0; index < l; index++) {
            let [chunk, key] = chunks[index];

            name = `chunk${index}.mp3`;
            await fetchChunk(makePlaylist(chunk, key), name);
            process.stdout.write(`Chunk ${index+1} of ${l} fetched: ` + progress(l, index) + '      \r');

            pieces.push(`file '${name}'`);
            if (index % 30 === 0 || index == l - 1) {
              await concatPieces(pieces, resultName);
              pieces = [`file '${resultName}'`];
            }
          }
        });
      }).on('error', (err) => {
        console.log('Error: ' + err.message);
      });
    });
}

if (args && args.length && args.length == 2) {
  main(args[0], args[1]);
}
