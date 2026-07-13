#!/usr/bin/env node
import { serve } from './server.js';
import { parseSpeakArgs, readStdin, speakText } from './speak.js';
import { prepareNativeSpeechOverlay, startSpeechController } from './controller.js';
import { runSpeechDaemon, sendSpeakToDaemon, stopSpeechDaemonPlayback } from './daemon.js';
import { prepareNativeMenuBar, startNativeMenuBar } from './menubar.js';

interface Args {
  port: number;
  open: boolean;
  help: boolean;
}

const DEFAULT_PORT = 7878;

function parseArgs(argv: string[]): Args {
  const args: Args = { port: DEFAULT_PORT, open: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--port') args.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (token === '--no-open') args.open = false;
    else if (token === '--help' || token === '-h') args.help = true;
  }
  return args;
}

function printHelp(): void {
  console.log(`
kokoro-reader - paste text and read it aloud with Kokoro AI.

USAGE
  npm run dev
  npm run dev -- --port 7879
  npm run dev -- --no-open
  npm run start -- speak --stdin --no-open
  npm run start -- speak --voice daniel --rate 1.25 "Text to read"

OPTIONS
  --port <n>   Server port. Defaults to ${DEFAULT_PORT}.
  --no-open    Do not open the browser automatically.
  -h, --help   Show this help.
`);
}

function printSpeakHelp(): void {
  console.log(`
kokoro-reader speak - read stdin or command text aloud with Kokoro AI.

USAGE
  npm run start -- speak --stdin --no-open
  npm run start -- speak --voice daniel --rate 1.25 "Text to read"

OPTIONS
  --stdin       Read text from stdin. This is the default when no text is passed.
  --voice <id>  Kokoro voice id or alias. Defaults to af_heart.
  --rate <n>    Speech rate. Defaults to 1.
  --mode <mode> Reading mode: auto, fast-start, or smooth. Defaults to fast-start.
  --auto        Balance a quick start with a short prepared queue.
  --smooth      Use larger chunks and a deeper prepared queue for long reads.
  --prefetch <n> Number of future chunks to prepare ahead. Defaults to 3.
  --workers <n> Number of Kokoro model workers. Defaults to 1.
  --controller Show a small Stop/progress window while speaking.
  --daemon     Send speech to the lightweight local daemon.
  --popup      Legacy alias for --controller.
  --no-batch    Generate the full selection before playing it.
  --no-open     Accepted for macOS Service compatibility.
  -h, --help    Show this help.
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'daemon') {
    await runSpeechDaemon();
    return;
  }

  if (argv[0] === 'stop-daemon') {
    await stopSpeechDaemonPlayback();
    return;
  }

  if (argv[0] === 'prepare-controller') {
    prepareNativeSpeechOverlay();
    return;
  }

  if (argv[0] === 'prepare-menubar') {
    prepareNativeMenuBar();
    return;
  }

  if (argv[0] === 'menubar') {
    startNativeMenuBar();
    return;
  }

  if (argv[0] === 'speak') {
    const args = parseSpeakArgs(argv);
    if (args.help) {
      printSpeakHelp();
      return;
    }
    const text = args.stdin ? await readStdin() : args.text;
    if (args.daemon) {
      await sendSpeakToDaemon({
        batch: args.batch,
        mode: args.modeExplicit ? args.mode : undefined,
        prefetch: args.prefetch,
        rate: args.rateExplicit ? args.rate : undefined,
        text,
        voice: args.voiceExplicit ? args.voice : undefined,
      });
      return;
    }

    const abort = new AbortController();
    let currentRate = args.rate;
    const controller = args.controller ? await startSpeechController({
      initialRate: currentRate,
      onRate: (rate) => {
        currentRate = rate;
      },
      onStop: () => abort.abort(),
    }) : undefined;
    try {
      const result = await speakText({
        batch: args.batch,
        mode: args.mode,
        onProgress: (progress) => controller?.update(progress),
        playbackRate: () => currentRate,
        prefetch: args.prefetch,
        rate: 1,
        signal: abort.signal,
        text,
        voice: args.voice,
        workers: args.workers,
      });
      controller?.update({ message: 'Finished reading', status: 'done' });
      console.log(`kokoro-reader spoke ${result.cached ? 'cached' : 'generated'} audio with ${result.voice} at ${currentRate}x.`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        controller?.update({ message: 'Stopped', status: 'stopped' });
        console.log('kokoro-reader stopped.');
        return;
      }
      controller?.update({
        message: (err as Error).message,
        status: 'error',
      });
      throw err;
    } finally {
      controller?.close(1800);
    }
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }
  serve({ port: args.port, open: args.open });
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
