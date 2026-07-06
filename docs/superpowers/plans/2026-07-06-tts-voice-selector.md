# TTS Voice Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TTS mute button in the sidebar with a popover dropdown that lets users toggle mute and switch between voices, and add a voice checkbox list to General settings.

**Architecture:** Add `KOKORO_VOICES` constant and `kokoroEnabledVoices` field to `SpeechSettings` in contracts, then wire them into two UI surfaces: a popover on the sidebar trigger button and a checkbox list in the General settings panel.

**Tech Stack:** React, Effect Schema, Radix/base-ui Popover, lucide-react icons, Zustand (for mute state)

## Global Constraints

- Voice names are displayed as-is — no friendly labels
- `KOKORO_VOICES` is the single source of truth for the master list
- No new settings nav entry — voice section goes inside General
- The popover trigger is visually identical to the current mute button (volume icon, same size)

---

### Task 1: Add KOKORO_VOICES constant and kokoroEnabledVoices field

**Files:**
- Modify: `packages/contracts/src/settings.ts:366-445`
- Modify: `packages/contracts/src/settings.ts:604-614` (ServerSettingsPatch.speech)
- Test: `packages/contracts/src/settings.test.ts`

**Interfaces:**
- Produces:
  - `KOKORO_VOICES: readonly string[]` — exported from `@t3tools/contracts`
  - `SpeechSettings` gains field `kokoroEnabledVoices: readonly string[]` (defaults to all voices)
  - `ServerSettingsPatch.speech` gains optional key `kokoroEnabledVoices`

- [ ] **Step 1: Write the failing tests**

Add to `packages/contracts/src/settings.test.ts`:

```ts
import {
  KOKORO_VOICES,
  DEFAULT_KOKORO_VOICE,
} from "./settings.ts";

describe("SpeechSettings.kokoroEnabledVoices", () => {
  it("defaults to all KOKORO_VOICES when speech key is absent", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.speech.kokoroEnabledVoices).toEqual([...KOKORO_VOICES]);
  });

  it("round-trips a partial enabled list", () => {
    const decoded = decodeServerSettings({
      speech: { kokoroEnabledVoices: ["af_heart", "am_adam"] },
    });
    expect(decoded.speech.kokoroEnabledVoices).toEqual(["af_heart", "am_adam"]);
  });

  it("accepts kokoroEnabledVoices in ServerSettingsPatch.speech", () => {
    const patch = decodeServerSettingsPatch({
      speech: { kokoroEnabledVoices: ["bf_emma"] },
    });
    expect(patch.speech?.kokoroEnabledVoices).toEqual(["bf_emma"]);
  });

  it("KOKORO_VOICES contains DEFAULT_KOKORO_VOICE", () => {
    expect(KOKORO_VOICES).toContain(DEFAULT_KOKORO_VOICE);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/contracts && vp test run --reporter=verbose 2>&1 | grep -E "FAIL|kokoroEnabled|KOKORO_VOICES"
```

Expected: failures referencing `KOKORO_VOICES is not exported` or similar.

- [ ] **Step 3: Add KOKORO_VOICES constant**

In `packages/contracts/src/settings.ts`, immediately after line 366 (`export const DEFAULT_KOKORO_VOICE = "af_heart";`), add:

```ts
export const KOKORO_VOICES = [
  "af_heart",
  "af_bella",
  "af_nova",
  "af_sky",
  "af_sarah",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
] as const;
```

- [ ] **Step 4: Add kokoroEnabledVoices to SpeechSettings**

In `packages/contracts/src/settings.ts`, add the field inside the `makeProviderSettingsSchema({...})` call, after the `kokoroVoice` field (after line 432):

```ts
    kokoroEnabledVoices: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([...KOKORO_VOICES])),
      Schema.annotateKey({
        title: "Enabled voices",
        description: "Voices available in the sidebar voice picker.",
      }),
    ),
```

Then update the `order` array (currently ending at `"kokoroVoice"`) to include `"kokoroEnabledVoices"`:

```ts
    order: [
      "sttEnabled",
      "ttsEnabled",
      "whisperBinaryPath",
      "whisperModelPath",
      "kokoroCommand",
      "kokoroModelPath",
      "kokoroVoice",
      "kokoroEnabledVoices",
    ],
```

- [ ] **Step 5: Add kokoroEnabledVoices to ServerSettingsPatch.speech**

In `packages/contracts/src/settings.ts`, inside `ServerSettingsPatch`, add to the `speech` struct after `kokoroVoice: Schema.optionalKey(TrimmedString)` (line ~612):

```ts
      kokoroEnabledVoices: Schema.optionalKey(Schema.Array(Schema.String)),
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd packages/contracts && vp test run --reporter=verbose 2>&1 | grep -E "PASS|FAIL|kokoroEnabled|KOKORO_VOICES"
```

Expected: all 4 new tests PASS.

- [ ] **Step 7: Typecheck**

```bash
cd packages/contracts && npm run typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts
git commit -m "feat(contracts): add KOKORO_VOICES constant and kokoroEnabledVoices to SpeechSettings"
```

---

### Task 2: Replace SidebarTtsMuteButton with SidebarVoiceDropdown

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx:2743-2760`

**Interfaces:**
- Consumes:
  - `KOKORO_VOICES: readonly string[]` from `@t3tools/contracts`
  - `DEFAULT_KOKORO_VOICE: string` from `@t3tools/contracts`
  - `primaryServerSettingsAtom` — already imported at line ~54
  - `useVoiceStore` — already imported
  - `useUpdatePrimarySettings` from `~/hooks/useSettings` (new import)
  - `Popover, PopoverPopup, PopoverTrigger` from `~/components/ui/popover` (new import)
  - `Switch` from `~/components/ui/switch` (new import)
  - `CheckIcon` from `lucide-react` (new import)
  - `cn` from `~/lib/utils` (new import)
- Produces: `SidebarVoiceDropdown` replaces `SidebarTtsMuteButton` in `SidebarChromeHeader`

- [ ] **Step 1: Add new imports to Sidebar.tsx**

In the lucide-react import block (line 1), add `CheckIcon`:

```ts
import {
  ArchiveIcon,
  ArrowUpDownIcon,
  CheckIcon,          // add this
  ChevronRightIcon,
  CloudIcon,
  ContainerIcon,
  FolderPlusIcon,
  Globe2Icon,
  LoaderIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
```

Near the `isMacPlatform` import (line 82), also import `cn`:

```ts
import { cn, isMacPlatform } from "../lib/utils";
```

Near where `useClientSettings, useUpdateClientSettings` is imported (line 210), add `useUpdatePrimarySettings`:

```ts
import { useClientSettings, useUpdateClientSettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
```

Add new imports for the popover and switch (place them near other ui imports in the file):

```ts
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
```

Add import for `KOKORO_VOICES` and `DEFAULT_KOKORO_VOICE` near the other `@t3tools/contracts` import (line ~54):

```ts
import {
  // ... existing imports ...
  KOKORO_VOICES,
  DEFAULT_KOKORO_VOICE,
} from "@t3tools/contracts";
```

- [ ] **Step 2: Replace SidebarTtsMuteButton with SidebarVoiceDropdown**

Replace the entire `SidebarTtsMuteButton` function (lines 2743–2761 in the original) with:

```tsx
function SidebarVoiceDropdown() {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const updateSettings = useUpdatePrimarySettings();
  const ttsMuted = useVoiceStore((s) => s.ttsMuted);
  const toggleTtsMuted = useVoiceStore((s) => s.toggleTtsMuted);

  if (!settings.speech.ttsEnabled) return null;

  const enabledVoices = settings.speech.kokoroEnabledVoices ?? [...KOKORO_VOICES];
  const activeVoice = settings.speech.kokoroVoice || DEFAULT_KOKORO_VOICE;

  return (
    <Popover>
      <PopoverTrigger
        className="ml-auto flex size-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground/80"
        aria-label="Voice options"
      >
        {ttsMuted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={8} viewportClassName="py-2">
        <div className="flex items-center justify-between gap-4 px-1">
          <span className="text-sm font-medium">Text-to-speech</span>
          <Switch
            checked={!ttsMuted}
            onCheckedChange={() => toggleTtsMuted()}
            aria-label="Toggle text-to-speech mute"
          />
        </div>
        {enabledVoices.length > 0 && (
          <div className="mt-2 flex flex-col border-t border-border pt-2">
            {enabledVoices.map((voice) => (
              <button
                key={voice}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm",
                  voice === activeVoice
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() =>
                  updateSettings({ speech: { ...settings.speech, kokoroVoice: voice } })
                }
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {voice === activeVoice && <CheckIcon className="size-3" />}
                </span>
                {voice}
              </button>
            ))}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
```

- [ ] **Step 3: Update SidebarChromeHeader to use the new component**

In `SidebarChromeHeader` (lines 2763–2781), rename both occurrences of `<SidebarTtsMuteButton />` to `<SidebarVoiceDropdown />`:

```tsx
// Electron branch (line ~2772):
<SidebarVoiceDropdown />

// Non-Electron branch (line ~2778):
<SidebarVoiceDropdown />
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/web && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(ui): replace TTS mute button with SidebarVoiceDropdown popover"
```

---

### Task 3: Add voice checkbox section to GeneralSettingsPanel

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx:479+`

**Interfaces:**
- Consumes:
  - `KOKORO_VOICES` and `DEFAULT_KOKORO_VOICE` from `@t3tools/contracts` (new imports)
  - `Checkbox` from `../ui/checkbox` (new import)
  - `settings.speech.ttsEnabled` — gate for rendering
  - `settings.speech.kokoroEnabledVoices` — checked state per voice
  - `settings.speech.kokoroVoice` — detect if active voice was unchecked
  - `updateSettings` — already available in `GeneralSettingsPanel`

- [ ] **Step 1: Add imports to SettingsPanels.tsx**

Near the existing `@t3tools/contracts` import (line 13), add:

```ts
import {
  // ... existing imports ...
  KOKORO_VOICES,
  DEFAULT_KOKORO_VOICE,
} from "@t3tools/contracts";
```

Add the `Checkbox` import near other ui imports:

```ts
import { Checkbox } from "../ui/checkbox";
```

- [ ] **Step 2: Add voice section inside GeneralSettingsPanel**

At the end of `GeneralSettingsPanel`'s return value, inside `<SettingsPageContainer>`, after the last existing `<SettingsSection>`, add:

```tsx
{settings.speech.ttsEnabled && (
  <SettingsSection title="Voice">
    <div className="px-4 py-3.5 sm:px-5">
      <p className="mb-3 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
        Available voices
      </p>
      <div className="flex flex-col gap-2">
        {KOKORO_VOICES.map((voice) => {
          const enabledVoices =
            settings.speech.kokoroEnabledVoices ?? [...KOKORO_VOICES];
          const isChecked = enabledVoices.includes(voice);
          const isLastEnabled = isChecked && enabledVoices.length === 1;
          return (
            <label
              key={voice}
              className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground"
            >
              <Checkbox
                checked={isChecked}
                disabled={isLastEnabled}
                onCheckedChange={(checked) => {
                  const current =
                    settings.speech.kokoroEnabledVoices ?? [...KOKORO_VOICES];
                  const next =
                    checked === true
                      ? [...current, voice]
                      : current.filter((v) => v !== voice);
                  const speechPatch: {
                    kokoroEnabledVoices: string[];
                    kokoroVoice?: string;
                  } = { kokoroEnabledVoices: next };
                  if (
                    checked !== true &&
                    settings.speech.kokoroVoice === voice
                  ) {
                    speechPatch.kokoroVoice = next[0] ?? DEFAULT_KOKORO_VOICE;
                  }
                  updateSettings({
                    speech: { ...settings.speech, ...speechPatch },
                  });
                }}
              />
              {voice}
            </label>
          );
        })}
      </div>
    </div>
  </SettingsSection>
)}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat(ui): add voice checkbox section to General settings"
```
