import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  BellIcon,
  ChartNoAxesColumnIcon,
  CheckIcon,
  ChevronUpIcon,
  GitPullRequestIcon,
  SettingsIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { DEFAULT_KOKORO_VOICE, KOKORO_VOICES } from "@t3tools/contracts";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useUpdatePrimarySettings } from "../../hooks/useSettings";
import { primaryServerSettingsAtom } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { useVoiceStore } from "../../voice/useVoiceStore";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  resolveSidebarStageFocusRingOffsetClass,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { TtsEngineSelect } from "../voice/TtsEngineSelect";
import { CHATTERBOX_VOICE_NOTE, shouldShowKokoroVoices } from "../voice/ttsEngine";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "focus-visible:ring-white/90 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white! [:hover,[data-pressed]]:bg-white/15",
          backdropVariant && resolveSidebarStageFocusRingOffsetClass(backdropVariant),
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 rounded-full px-1.5 text-muted-foreground"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <T3Wordmark />
      <span
        className={cn(
          "-translate-y-px truncate text-sm font-medium tracking-tight",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        Code
      </span>
    </Link>
  );
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SidebarAudioModeButton() {
  const audioMode = useVoiceStore((s) => s.audioMode);
  const cycleAudioMode = useVoiceStore((s) => s.cycleAudioMode);

  const { Icon, label } =
    audioMode === "all"
      ? { Icon: Volume2Icon, label: "All sounds" }
      : audioMode === "notify"
        ? { Icon: BellIcon, label: "Notifications only" }
        : { Icon: VolumeXIcon, label: "No sound" };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Audio: ${label} (click to change)`}
            onClick={() => cycleAudioMode()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon className="size-4" />
          </button>
        }
      />
      <TooltipPopup side="top">{`Audio: ${label} (click to change)`}</TooltipPopup>
    </Tooltip>
  );
}

function SidebarVoiceDropdown() {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const updateSettings = useUpdatePrimarySettings();
  const beepUnfocusedOnly = useVoiceStore((s) => s.beepUnfocusedOnly);
  const setBeepUnfocusedOnly = useVoiceStore((s) => s.setBeepUnfocusedOnly);

  const ttsEnabled = settings.speech.ttsEnabled;
  const enabledVoices = settings.speech.kokoroEnabledVoices ?? [...KOKORO_VOICES];
  const activeVoice = settings.speech.kokoroVoice || DEFAULT_KOKORO_VOICE;
  const ttsEngine = settings.speech.ttsEngine ?? "kokoro";

  return (
    <Popover>
      <PopoverTrigger
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Audio options"
      >
        <ChevronUpIcon className="size-4" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" sideOffset={8} viewportClassName="py-2">
        <div className="flex items-center justify-between gap-4 px-1">
          <span className="text-sm font-medium">Only beep when unfocused</span>
          <Switch
            checked={beepUnfocusedOnly}
            onCheckedChange={(checked) => setBeepUnfocusedOnly(checked)}
            aria-label="Only beep when the app is unfocused"
          />
        </div>
        {ttsEnabled && (
          <div className="mt-2 flex items-center justify-between gap-4 border-t border-border px-1 pt-2">
            <span className="text-sm font-medium">TTS engine</span>
            <TtsEngineSelect
              value={ttsEngine}
              onChange={(engine) =>
                updateSettings({ speech: { ...settings.speech, ttsEngine: engine } })
              }
              triggerClassName="w-32"
            />
          </div>
        )}
        {ttsEnabled && !shouldShowKokoroVoices(ttsEngine) && (
          <p className="mt-2 border-t border-border px-1 pt-2 text-xs text-muted-foreground">
            {CHATTERBOX_VOICE_NOTE}
          </p>
        )}
        {ttsEnabled && shouldShowKokoroVoices(ttsEngine) && enabledVoices.length > 0 && (
          <div className="mt-2 flex flex-col border-t border-border pt-2">
            <span className="px-1 pb-1 text-xs text-muted-foreground">Voice</span>
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

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      location.pathname === "/usage"
        ? "usage"
        : location.pathname === "/pull-requests"
          ? "pull-requests"
          : null,
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/pull-requests", search: { involvement: "all", state: "open" } });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/" });
  }, [closeMobileSidebar, navigate]);

  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarMenu className="flex-row items-center">
        {currentFooterPage ? (
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          <>
            <SidebarMenuItem className="shrink-0">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SidebarMenuButton
                      aria-label="Settings"
                      onClick={handleSettingsClick}
                      size="icon"
                    >
                      <SettingsIcon />
                    </SidebarMenuButton>
                  }
                />
                <TooltipPopup side="top">Settings</TooltipPopup>
              </Tooltip>
            </SidebarMenuItem>
            {pullRequestsSupported ? (
              <SidebarMenuItem className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        aria-label="Pull Requests"
                        onClick={handlePullRequestsClick}
                        size="icon"
                      >
                        <GitPullRequestIcon />
                      </SidebarMenuButton>
                    }
                  />
                  <TooltipPopup side="top">Pull Requests</TooltipPopup>
                </Tooltip>
              </SidebarMenuItem>
            ) : null}
            <SidebarMenuItem className="shrink-0">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SidebarMenuButton aria-label="Usage" onClick={handleUsageClick} size="icon">
                      <ChartNoAxesColumnIcon />
                    </SidebarMenuButton>
                  }
                />
                <TooltipPopup side="top">Usage</TooltipPopup>
              </Tooltip>
            </SidebarMenuItem>
          </>
        )}
        <SidebarMenuItem className="ms-auto flex shrink-0 items-center gap-1">
          <SidebarAudioModeButton />
          <SidebarVoiceDropdown />
        </SidebarMenuItem>
        <SidebarUpdatePill />
      </SidebarMenu>
    </SidebarFooter>
  );
});
