import { Blocks, Puzzle } from "@openbot/ui";
import { createMemo, createSignal, Show } from "solid-js";

/**
 * Local privacy mode: an icon from a vendor host is not requested, so the placeholder shows instead.
 * Only an icon that is already on this computer (`data:`, `blob:` or an app scheme) can load.
 */
export function localIconUrl(url: string | null | undefined): string | null {
  return url && !/^https?:/iu.test(url) ? url : null;
}

/** A listing's icon, or a plugin or skill mark when it has none or it does not load. */
export function PluginIcon(props: { iconUrl: string | null; fallback?: "plugin" | "skill"; class?: string }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = createMemo(() => {
    const url = localIconUrl(props.iconUrl);
    return url && failedUrl() !== url ? url : null;
  });
  return (
    <span class={props.class ? `skills-marketplace-icon ${props.class}` : "skills-marketplace-icon"}>
      <Show when={iconUrl()} fallback={props.fallback === "skill" ? <Blocks /> : <Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}
