import fableIcon from "../assets/model-families/fable.png";
import haikuIcon from "../assets/model-families/haiku.png";
import opusIcon from "../assets/model-families/opus.png";
import sonnetIcon from "../assets/model-families/sonnet.png";

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku" | null;

const MODEL_FAMILY_ICON_SRC = {
  fable: fableIcon,
  opus: opusIcon,
  sonnet: sonnetIcon,
  haiku: haikuIcon,
} as const;

export function getModelFamily(model: string): ModelFamily {
  const normalized = normalizeKey(model);
  if (normalized.includes("fable")) return "fable";
  if (normalized.includes("sonnet")) return "sonnet";
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("haiku")) return "haiku";
  return null;
}

export function ModelFamilyIcon({ model }: { model: string }) {
  const family = getModelFamily(model);
  if (!family) return null;

  return (
    <span className={`model-family-icon ${family}`} aria-hidden="true">
      <img className="model-family-icon-image" src={MODEL_FAMILY_ICON_SRC[family]} alt="" />
    </span>
  );
}