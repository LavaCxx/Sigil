/**
 * 字体包相关状态。
 */

import { atom, computed, task } from "nanostores";
import type { LoadedPack, PackRegistryEntry } from "~/types/pack";
import { loadPack } from "~/lib/packs/loader";

/** 已知的字体包列表（手动维护，未来可改成 fetch /packs/index.json 动态发现） */
export const $registry = atom<PackRegistryEntry[]>([
  { id: "nte", name_zh: "异环", name_en: "Neverness to Everness" },
]);

export const $currentPackId = atom<string | null>("nte");

export const $loadedPack = atom<LoadedPack | null>(null);

export const $packLoading = atom<boolean>(false);
export const $packError = atom<string | null>(null);

export const $currentPackEntry = computed(
  [$registry, $currentPackId],
  (registry, id) => registry.find((p) => p.id === id) ?? null
);

/** 切换当前字体包并触发加载。返回 promise 便于调用方等待。 */
export async function selectPack(id: string): Promise<void> {
  if ($currentPackId.get() === id && $loadedPack.get()?.meta.id === id) {
    return;
  }
  $currentPackId.set(id);
  $packLoading.set(true);
  $packError.set(null);

  try {
    const pack = await loadPack(id);
    $loadedPack.set(pack);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    $packError.set(message);
    $loadedPack.set(null);
  } finally {
    $packLoading.set(false);
  }
}

/** 应用启动时调用一次，加载默认字体包 */
export function bootstrapPacks(): void {
  task(async () => {
    const id = $currentPackId.get();
    if (id) {
      await selectPack(id);
    }
  });
}
