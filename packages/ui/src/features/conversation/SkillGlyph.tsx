import { Puzzle } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { localIconUrl } from "../marketplace/PluginIcon";

export function SkillGlyph(props: { iconUrl: string | null }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = () => {
    const icon = localIconUrl(props.iconUrl);
    return icon && failedUrl() !== icon ? icon : null;
  };

  return (
    <span class="agent-skill-icon" aria-hidden="true">
      <Show when={iconUrl()} fallback={<Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}
