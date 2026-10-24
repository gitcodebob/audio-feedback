// Zet een bewaarde opname om naar mp3 en streamt die meteen naar de client, zonder
// tussenbestand. Veel verwerkingstools (transcriptie, editors) weigeren WebM of Ogg
// met alleen audio; mp3 lezen ze allemaal. ffmpeg is het enige systeemprogramma dat
// de server nodig heeft: niets in Node decodeert Opus.

import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';

/** Spraak is met 64 kbit/s mono ruim goed verstaanbaar; het origineel is maar 32 kbit/s Opus. */
const ARGS = (input: string) => [
  '-hide_banner', '-loglevel', 'error', '-nostdin',
  // De audio komt van willekeurige browsers: een bestand mag niet naar een URL of playlist verwijzen.
  '-protocol_whitelist', 'file,pipe',
  '-i', input,
  '-vn', '-map_metadata', '-1',
  '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k',
  // Naar een pipe kan ffmpeg de Xing-header niet achteraf bijwerken, en een header die
  // nul frames meldt laat sommige tools denken dat het bestand leeg is. Zonder header
  // rekenen ze de duur uit de bitrate, en die is vast.
  '-write_xing', '0',
  // Ook geen ID3-tag met alleen "encoder=Lavf": het bestand begint dan direct met audio.
  '-id3v2_version', '0',
  '-f', 'mp3', 'pipe:1',
];

/** Bovengrens voor één omzetting; een opname van uren duurt op een kleine CPU een minuut of twee. */
const TIMEOUT_MS = 5 * 60 * 1000;

export class Mp3Error extends Error {
  /** ffmpeg is er niet (of niet uitvoerbaar): een instelling, geen fout in deze opname. */
  readonly unavailable: boolean;
  constructor(message: string, unavailable = false) {
    super(message);
    this.unavailable = unavailable;
  }
}

/**
 * Schrijft de mp3 naar res, met headers erbij. De belofte loopt af als ffmpeg klaar is,
 * zodat de aanroeper zo lang een plek kan bezet houden. Faalt ffmpeg voordat er audio is,
 * dan wordt hij afgewezen en is er nog niets verstuurd: de aanroeper kan dan een nette
 * fout geven. Faalt het daarna, dan wordt de verbinding verbroken (zodat een afgebroken
 * download niet voor een complete doorgaat); haakt de client af, dan stopt ffmpeg.
 */
export function sendMp3(ffmpegPath: string, input: string, res: ServerResponse, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ARGS(input), { stdio: ['ignore', 'pipe', 'pipe'] });
    // Zelf een timer: de timeout-optie van spawn blijft hangen als ffmpeg niet eens start.
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => {
      if (stderr.length < 2000) stderr += text;
    });

    let started = false;
    let gone = false;
    const fail = (error: Mp3Error) => {
      if (started) {
        res.destroy();
        resolve();
      } else if (gone) {
        resolve(); // de client was al weg, dus er is niemand om een fout te geven
      } else {
        reject(error);
      }
    };

    child.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(new Mp3Error(`ffmpeg starten lukte niet: ${err.message}`, err.code === 'ENOENT' || err.code === 'EACCES'));
    });

    // Pas bij de eerste audio beginnen met antwoorden: tot dan kan het nog een gewone fout worden.
    child.stdout.once('data', (first: Buffer) => {
      child.stdout.pause();
      started = true;
      res.writeHead(200, headers);
      res.write(first);
      // Zelf afsluiten (hieronder): zou pipe dat doen, dan lijkt een afgebroken omzetting compleet.
      child.stdout.pipe(res, { end: false });
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        if (started) {
          res.end();
          resolve();
        } else {
          fail(new Mp3Error('ffmpeg gaf geen audio'));
        }
      } else {
        fail(new Mp3Error(`ffmpeg stopte met ${code ?? signal}: ${stderr.trim()}`));
      }
    });

    res.once('close', () => {
      gone = true;
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
  });
}
