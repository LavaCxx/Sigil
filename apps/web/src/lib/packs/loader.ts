/**
 * 字体包动态加载器：
 * 给定 pack id，从 /packs/<id>/ 加载 meta.json 和 mapping.json，
 * 返回 LoadedPack（模型本身的加载由 inference 层在需要时按需进行）。
 */

import type {
  GlyphPackMapping,
  GlyphPackMeta,
  LoadedPack,
} from "~/types/pack";

const PACK_BASE_URL = "/packs";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`无法加载 ${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loadPack(id: string): Promise<LoadedPack> {
  const baseUrl = `${PACK_BASE_URL}/${id}`;
  const [meta, mapping] = await Promise.all([
    fetchJson<GlyphPackMeta>(`${baseUrl}/meta.json`),
    fetchJson<GlyphPackMapping>(`${baseUrl}/mapping.json`),
  ]);

  if (meta.id !== id) {
    throw new Error(`字体包 id 不一致：URL 是 ${id}，meta.json 声明 ${meta.id}`);
  }

  return { meta, mapping, baseUrl };
}

export function packAssetUrl(pack: LoadedPack, fileKey: keyof LoadedPack["meta"]["files"]): string {
  return `${pack.baseUrl}/${pack.meta.files[fileKey]}`;
}
