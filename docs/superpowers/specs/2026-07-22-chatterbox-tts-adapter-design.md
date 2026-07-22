# Chatterbox TTS adapter (coexist with Kokoro) — design

Date: 2026-07-22
Status: approved (brainstorm), pending implementation plan

## Goal

Try Resemble AI's [Chatterbox](https://github.com/resemble-ai/chatterbox) as an
alternative local TTS engine, **without disturbing the working Kokoro path**.
Switch between engines by editing one setting.

## Background: the engine-agnostic TTS contract

`apps/server/src/speech/TextToSpeech.ts` does not know about Kokoro specifically.
It spawns the command configured as `speech.kokoroCommand` with:

- `--out <wav-path>` (where to write the result)
- `--voice <name>`
- `--model <path>` (only when `kokoroModelPath` is set)
- `--speed <n>` (only when a speed is provided)

and pipes the text to speak on **stdin**, then reads the WAV bytes back from
`--out`. Kokoro is just an adapter script (`~/opt/t3-voice/kokoro_adapter.py`)
that satisfies this contract, fronted by `tts-wrapper.sh` which holds the
notification-mute lock. See memory `voice-mode-setup` and
`voice-notification-sound-guard`.

Therefore a new TTS engine drops in as **a new adapter behind the same
contract**. No changes to `TextToSpeech.ts`, the server, or the web app.

## Decisions

- **Coexist, not replace.** Keep the Kokoro adapter untouched. Add a parallel
  Chatterbox adapter. A/B by flipping `speech.kokoroCommand`.
- **CPU nano model.** This machine has no NVIDIA GPU, so Turbo is not viable.
  Use `ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)`
  ("3x faster than realtime on 8 CPU cores").
- **Built-in default voice.** Chatterbox has no named voices; it clones from a
  reference clip or uses a built-in default. Pass **no reference clip** →
  default voice. The `--voice` arg the server sends is accepted and ignored.
  (Reference-clip cloning is a possible later addition, out of scope now.)
- **Isolated venv.** `chatterbox-tts` pulls in torch (~2GB+). Give it its own
  `chatterbox-venv`, do not pollute `kokoro-venv`.
- **Setting keys unchanged.** The `kokoro*` setting keys keep their names.
  Renaming them to be engine-neutral is out of scope for this experiment.

## Artifacts (all under `~/opt/t3-voice/`)

| File                        | Purpose                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatterbox-venv/`          | Dedicated Python venv with `chatterbox-tts` + `torch` + `torchaudio`.                                                                                                                                                                                                                                                                             |
| `chatterbox_adapter.py`     | Same CLI surface as `kokoro_adapter.py`: `--out` required; `--voice`/`--model`/`--voices`/`--speed` accepted and **ignored** (nano has no named voices or speed control). Reads text from stdin. Loads the nano model on CPU, calls `model.generate(text)` with no reference clip, writes a 24 kHz WAV via `torchaudio.save(out, wav, model.sr)`. |
| `tts-wrapper-chatterbox.sh` | Clone of `tts-wrapper.sh`: touches/refreshes `~/.t3/voice-active.lock` every 2s while running (keeps the Claude Code task-done sound muted during synthesis), execs `chatterbox-venv/bin/python chatterbox_adapter.py "$@"`.                                                                                                                      |

## Adapter CLI contract (must match what the server passes)

```
chatterbox_adapter.py --out <path> [--voice <name>] [--model <path>] \
                      [--voices <path>] [--speed <float>]
# text to speak arrives on stdin
# writes a WAV file to <path>; exit 0 on success, non-zero on failure
```

argparse must define `--voice`, `--model`, `--voices`, `--speed` so the process
never crashes on args the server includes; their values are unused.

## Switching engines (the A/B knob)

Edit `speech.kokoroCommand` in the relevant settings file:

- Kokoro: `/home/thomas/opt/t3-voice/tts-wrapper.sh`
- Chatterbox: `/home/thomas/opt/t3-voice/tts-wrapper-chatterbox.sh`

Both `~/.t3/dev/settings.json` (used by `pnpm run dev`) and
`~/.t3/userdata/settings.json` (production/CLI) exist — change whichever mode is
being tested. `config.ts:96` selects the dir by mode.

## Verification

1. **Direct adapter run:**
   `echo "hello world" | ~/opt/t3-voice/tts-wrapper-chatterbox.sh --out /tmp/cb.wav`
   → exit 0, `/tmp/cb.wav` is a playable ~24 kHz WAV (`file`/`soxi` to confirm
   format + sample rate).
2. **Lock behavior:** while the adapter runs, `~/.t3/voice-active.lock` mtime
   refreshes (same guarantee as `tts-wrapper.sh`).
3. **App path:** point `speech.kokoroCommand` at the chatterbox wrapper, restart
   the server, trigger a "Listen" / narration. End-to-end audible playback in
   the browser needs a human at the speakers (unchanged from Kokoro).

## Risks / known limitations

- **Per-call model load latency.** Each request spawns a fresh process and
  reloads the model. torch + Chatterbox weights may take several seconds per
  utterance on CPU, which can make streaming narration feel laggy. Accepted for
  this experiment. If too slow, the follow-up is a persistent daemon adapter
  (out of scope now).
- **First-run download.** The nano weights (few hundred MB) download from
  HuggingFace on first use; needs internet, one-time.
- **API confirmation.** The exact nano import/call
  (`ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)`,
  `generate(text)` with no reference) is confirmed against the installed package
  version during implementation; adjust the adapter if the installed API differs.

## Out of scope

- Reference-clip voice cloning.
- Renaming `kokoro*` settings keys to engine-neutral names.
- Persistent-daemon adapter for latency.
- Any change to `TextToSpeech.ts`, server, or web code.
