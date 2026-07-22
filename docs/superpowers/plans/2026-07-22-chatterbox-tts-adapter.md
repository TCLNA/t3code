# Chatterbox TTS Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Resemble AI Chatterbox as an alternative local TTS engine that drops in behind the existing engine-agnostic TTS contract, switchable with Kokoro via one setting.

**Architecture:** `TextToSpeech.ts` spawns `speech.kokoroCommand` with `--out/--voice/--model/--speed`, pipes text on stdin, reads a WAV back. Chatterbox is a new adapter script satisfying that same contract, fronted by a lock wrapper, in its own venv. No repo/server/web code changes — the only "code" is machine-local scripts under `~/opt/t3-voice/`, and the only repo artifacts are this plan + its design doc.

**Tech Stack:** Python 3.12, `chatterbox-tts` (CPU nano model), torch/torchaudio, POSIX sh wrapper.

**Design doc:** `docs/superpowers/specs/2026-07-22-chatterbox-tts-adapter-design.md`

## Global Constraints

- CPU-only machine (no NVIDIA GPU): must use `device="cpu"` + nano model.
- Output WAV must be readable by the server's `FileSystem.readFile` — a normal WAV file at the `--out` path, exit 0 on success.
- Adapter argparse MUST accept `--out`, `--voice`, `--model`, `--voices`, `--speed` (server passes a subset); only `--out` and stdin are used.
- Do NOT touch `kokoro-venv`, `kokoro_adapter.py`, `tts-wrapper.sh`, or `TextToSpeech.ts`. Kokoro path stays working.
- Wrapper must preserve the notification-mute lock behavior: touch/refresh `~/.t3/voice-active.lock` every 2s while running (see `voice-notification-sound-guard`).
- All new artifacts live under `/home/thomas/opt/t3-voice/`.

---

### Task 1: Isolated venv + confirm nano API

**Files:**

- Create: `/home/thomas/opt/t3-voice/chatterbox-venv/` (Python venv)

**Interfaces:**

- Produces: a Python interpreter at `/home/thomas/opt/t3-voice/chatterbox-venv/bin/python` with `chatterbox` importable, and a CONFIRMED nano load+generate call signature for Task 2.

- [ ] **Step 1: Create the venv**

```bash
python3 -m venv /home/thomas/opt/t3-voice/chatterbox-venv
/home/thomas/opt/t3-voice/chatterbox-venv/bin/python -m pip install --upgrade pip
```

- [ ] **Step 2: Install chatterbox-tts (pulls torch ~2GB, one-time)**

```bash
/home/thomas/opt/t3-voice/chatterbox-venv/bin/pip install chatterbox-tts
```

Expected: install completes; `torch`, `torchaudio`, `chatterbox-tts` present in `pip list`.

- [ ] **Step 3: Confirm the nano API + default-voice generation (downloads weights, one-time)**

Run this probe (it both validates the API from the design doc and downloads the nano weights so later runs are fast):

```bash
/home/thomas/opt/t3-voice/chatterbox-venv/bin/python - <<'PY'
import inspect, torchaudio as ta
from chatterbox.tts_turbo import ChatterboxTurboTTS
print("from_pretrained sig:", inspect.signature(ChatterboxTurboTTS.from_pretrained))
m = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
print("generate sig:", inspect.signature(m.generate))
wav = m.generate("Chatterbox nano probe on C P U.")
print("sr:", m.sr, "wav shape:", tuple(wav.shape))
ta.save("/tmp/cb_probe.wav", wav, m.sr)
print("wrote /tmp/cb_probe.wav")
PY
file /tmp/cb_probe.wav
```

Expected: prints signatures, `sr: 24000`, and `file` reports a RIFF/WAVE audio file at 24000 Hz.

- [ ] **Step 4: Record the confirmed API**

If any of the calls in Step 3 differ from the design doc (class name, `nano=True` kwarg, `generate` taking no reference, `m.sr`), note the ACTUAL working form here in the plan before Task 2 — Task 2's adapter must use exactly what Step 3 proved works.

Confirmed form (fill in after Step 3):

- Import: `________`
- Load: `________`
- Generate (default voice): `________`
- Sample-rate attr: `________`

- [ ] **Step 5: No commit** (venv is machine-local, gitignored territory under `~/opt`).

---

### Task 2: `chatterbox_adapter.py`

**Files:**

- Create: `/home/thomas/opt/t3-voice/chatterbox_adapter.py`

**Interfaces:**

- Consumes: the confirmed nano API from Task 1 Step 4.
- Produces: a CLI `chatterbox_adapter.py --out <path> [--voice ..] [--model ..] [--voices ..] [--speed ..]` reading text on stdin, writing a WAV to `--out`, exit 0 on success. Task 3's wrapper calls it.

- [ ] **Step 1: Write the adapter**

Mirror `kokoro_adapter.py`'s shape. Use the API confirmed in Task 1 (below assumes the design-doc form; swap in the confirmed form if it differed):

```python
import argparse, sys
import torchaudio as ta
from chatterbox.tts_turbo import ChatterboxTurboTTS

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
# Accepted for contract compatibility; unused (nano has no named voices/speed).
parser.add_argument("--voice", default=None)
parser.add_argument("--model", default=None)
parser.add_argument("--voices", default=None)
parser.add_argument("--speed", type=float, default=None)
args = parser.parse_args()

text = sys.stdin.read().strip()
if not text:
    sys.stderr.write("chatterbox_adapter: empty stdin text\n")
    sys.exit(2)

model = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
wav = model.generate(text)          # default voice, no reference clip
ta.save(args.out, wav, model.sr)    # 24 kHz WAV
```

- [ ] **Step 2: Verify empty-input guard fails cleanly**

Run: `printf '' | /home/thomas/opt/t3-voice/chatterbox-venv/bin/python /home/thomas/opt/t3-voice/chatterbox_adapter.py --out /tmp/cb_empty.wav; echo "exit=$?"`
Expected: stderr "empty stdin text", `exit=2`, no `/tmp/cb_empty.wav` created.

- [ ] **Step 3: Verify happy path with the full arg set the server sends**

Run:

```bash
echo "Hello from Chatterbox nano." | \
  /home/thomas/opt/t3-voice/chatterbox-venv/bin/python \
  /home/thomas/opt/t3-voice/chatterbox_adapter.py \
  --out /tmp/cb_adapter.wav --voice af_nova --model /some/ignored/path --speed 1.0
echo "exit=$?"; file /tmp/cb_adapter.wav
```

Expected: `exit=0`; `file` reports RIFF/WAVE at 24000 Hz. (The `--voice`/`--model`/`--speed` values are ignored without error — this proves contract compatibility.)

- [ ] **Step 4: No repo commit** (script lives under `~/opt`, like `kokoro_adapter.py`).

---

### Task 3: `tts-wrapper-chatterbox.sh` (lock wrapper)

**Files:**

- Create: `/home/thomas/opt/t3-voice/tts-wrapper-chatterbox.sh`
- Reference: `/home/thomas/opt/t3-voice/tts-wrapper.sh` (clone its structure)

**Interfaces:**

- Consumes: `chatterbox_adapter.py` from Task 2.
- Produces: an executable the server can spawn as `speech.kokoroCommand` that refreshes `~/.t3/voice-active.lock` while synthesizing.

- [ ] **Step 1: Write the wrapper** (identical to `tts-wrapper.sh` except PY/ADAPTER paths)

```sh
#!/bin/sh
# Wraps the Chatterbox nano adapter (TTS). Holds a freshness lock while the
# engine runs so the Claude Code task-done sound stays silent during synthesis.
# Pointed at by t3 settings `speech.kokoroCommand`; the app appends
# `--out ... --voice ... --model ...` as arguments.
set -u

PY="/home/thomas/opt/t3-voice/chatterbox-venv/bin/python"
ADAPTER="/home/thomas/opt/t3-voice/chatterbox_adapter.py"
LOCK="/home/thomas/.t3/voice-active.lock"

touch "$LOCK" 2>/dev/null || true
( while kill -0 $$ 2>/dev/null; do touch "$LOCK" 2>/dev/null || true; sleep 2; done ) &
KEEPER=$!

"$PY" "$ADAPTER" "$@"
status=$?

kill "$KEEPER" 2>/dev/null || true
exit "$status"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x /home/thomas/opt/t3-voice/tts-wrapper-chatterbox.sh`

- [ ] **Step 3: Verify wrapper runs the adapter and refreshes the lock**

Run:

```bash
rm -f /tmp/cb_wrap.wav
BEFORE=$(stat -c %Y /home/thomas/.t3/voice-active.lock 2>/dev/null || echo 0)
echo "Wrapper lock test." | /home/thomas/opt/t3-voice/tts-wrapper-chatterbox.sh --out /tmp/cb_wrap.wav --voice af_nova
echo "exit=$?"
AFTER=$(stat -c %Y /home/thomas/.t3/voice-active.lock)
file /tmp/cb_wrap.wav
echo "lock before=$BEFORE after=$AFTER (after should be >= before)"
```

Expected: `exit=0`; WAV is RIFF/WAVE 24000 Hz; lock mtime refreshed (`after >= before`).

- [ ] **Step 4: No repo commit** (script lives under `~/opt`).

---

### Task 4: Wire into settings + app smoke test (the A/B switch)

**Files:**

- Modify: `/home/thomas/.t3/dev/settings.json` (key `speech.kokoroCommand`) — dev mode, used by `pnpm run dev`.
- (Optional, only if testing production/CLI) `/home/thomas/.t3/userdata/settings.json`.

**Interfaces:**

- Consumes: `tts-wrapper-chatterbox.sh` from Task 3.
- Produces: a running server whose TTS is served by Chatterbox, revertible to Kokoro by flipping one string.

- [ ] **Step 1: Back up dev settings**

Run: `cp /home/thomas/.t3/dev/settings.json /home/thomas/.t3/dev/settings.json.pre-chatterbox`

- [ ] **Step 2: Point `speech.kokoroCommand` at the chatterbox wrapper**

Edit `/home/thomas/.t3/dev/settings.json`, set:

```json
"kokoroCommand": "/home/thomas/opt/t3-voice/tts-wrapper-chatterbox.sh"
```

(Leave `kokoroModelPath`/`kokoroVoice` as-is — the adapter ignores them.)

- [ ] **Step 3: Verify settings still decode (JSON valid)**

Run: `python3 -c "import json,sys; d=json.load(open('/home/thomas/.t3/dev/settings.json')); print('kokoroCommand =', d['speech']['kokoroCommand'])"`
Expected: prints the chatterbox wrapper path, no JSON error.

- [ ] **Step 4: App smoke test (human-in-the-loop for audio)**

Restart the dev server (`pnpm run dev`), open the app, trigger a per-message **Listen** / narration. Confirm the server returns WAV bytes with no `TextToSpeechError`. Audible playback quality is a human judgment at the speakers — note whether latency is acceptable (see design-doc risk on per-call model load).

- [ ] **Step 5: Record the A/B revert instruction**

To go back to Kokoro: set `kokoroCommand` back to `/home/thomas/opt/t3-voice/tts-wrapper.sh` (or `cp` the `.pre-chatterbox` backup) and restart. Both wrappers coexist; only this string chooses the engine.

- [ ] **Step 6: No repo commit** (settings are machine-local under `~/.t3`).

---

## Self-Review

**Spec coverage:**

- Isolated venv → Task 1. ✅
- `chatterbox_adapter.py` with ignored `--voice/--model/--voices/--speed`, stdin text, 24 kHz WAV, default voice → Task 2. ✅
- `tts-wrapper-chatterbox.sh` lock behavior → Task 3. ✅
- A/B switch via `speech.kokoroCommand`, both settings files noted → Task 4. ✅
- Verification (direct run, lock behavior, app path) → Tasks 2/3/4. ✅
- Risk: API confirmation → Task 1 Step 3-4 explicitly confirms before coding. ✅
- Out of scope (cloning, key renames, daemon, server/web changes) → not present in any task. ✅

**Placeholder scan:** The only intentional fill-in is Task 1 Step 4's "confirmed API" block — by design, filled during execution from the probe's real output. Not a plan gap.

**Type consistency:** Adapter arg names (`--out/--voice/--model/--voices/--speed`) match the server contract and are reused verbatim across Tasks 2–4. Wrapper var names (`PY/ADAPTER/LOCK/KEEPER`) match `tts-wrapper.sh`.
