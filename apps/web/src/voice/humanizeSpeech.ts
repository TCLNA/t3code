import { stripMarkers } from "@t3tools/shared/speakableText";

import { voiceFetch } from "./voiceHttp";

/**
 * Send a marked sentence to the server LLM humanizer and return the spoken form.
 * Falls back to `stripMarkers()` on any failure (network error, timeout, bad
 * response) so audio is never blocked.
 */
export async function humanizeForSpeech(sentence: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await voiceFetch("/api/tts/humanize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence }),
      signal: controller.signal,
    });
    if (!response.ok) return stripMarkers(sentence);
    const data = (await response.json()) as { humanized?: string };
    return typeof data.humanized === "string" && data.humanized.length > 0
      ? data.humanized
      : stripMarkers(sentence);
  } catch {
    return stripMarkers(sentence);
  } finally {
    clearTimeout(timer);
  }
}
