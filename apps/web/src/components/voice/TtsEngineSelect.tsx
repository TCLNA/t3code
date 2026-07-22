import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TTS_ENGINE_OPTIONS, type TtsEngine } from "./ttsEngine";

export function TtsEngineSelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: TtsEngine;
  onChange: (engine: TtsEngine) => void;
  triggerClassName?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "kokoro" || next === "chatterbox") onChange(next);
      }}
    >
      <SelectTrigger className={triggerClassName ?? "w-full sm:w-40"} aria-label="TTS engine">
        <SelectValue>
          {TTS_ENGINE_OPTIONS.find((o) => o.value === value)?.label ?? "Kokoro"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {TTS_ENGINE_OPTIONS.map((o) => (
          <SelectItem hideIndicator key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
