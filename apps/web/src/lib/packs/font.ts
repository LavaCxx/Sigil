/**
 * 字体包字体的动态加载：
 * 通过 FontFace API 按需加载 packs/<id>/font.ttf，
 * 返回可直接用于 CSS font-family 的字体名，按 pack id 去重缓存。
 */

import type { LoadedPack } from "~/types/pack";
import { packAssetUrl } from "./loader";

const loadedFamilies = new Map<string, Promise<string>>();

export function ensurePackFont(pack: LoadedPack): Promise<string> {
  const family = `GlyphPackFont-${pack.meta.id}`;
  let pending = loadedFamilies.get(family);
  if (!pending) {
    pending = (async () => {
      const font = new FontFace(family, `url("${packAssetUrl(pack, "font")}")`);
      await font.load();
      document.fonts.add(font);
      return family;
    })();
    // 加载失败时清掉缓存，允许下次重试
    pending.catch(() => loadedFamilies.delete(family));
    loadedFamilies.set(family, pending);
  }
  return pending;
}
