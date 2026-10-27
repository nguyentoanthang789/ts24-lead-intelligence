// Settings service: đọc/lưu ScoringConfig versioned trong AppSetting
import { db } from "@/lib/db";
import { DEFAULT_SCORING_CONFIG, ScoringConfig, validateScoringConfig } from "./scoring-config";

const KEY = "scoring_config";

export async function getScoringConfig(): Promise<ScoringConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SCORING_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as ScoringConfig;
    const v = validateScoringConfig(parsed);
    return v.ok ? parsed : DEFAULT_SCORING_CONFIG;
  } catch {
    return DEFAULT_SCORING_CONFIG;
  }
}

export async function saveScoringConfig(cfg: ScoringConfig, actor = "operator"): Promise<{ ok: boolean; errors: string[] }> {
  const v = validateScoringConfig(cfg);
  if (!v.ok) return v;
  const existing = await db.appSetting.findUnique({ where: { key: KEY } });
  const prevVersion = existing ? (() => {
    try {
      return (JSON.parse(existing.value) as ScoringConfig).version ?? 0;
    } catch {
      return 0;
    }
  })() : 0;
  const next: ScoringConfig = { ...cfg, version: Math.max(cfg.version, prevVersion) + (JSON.stringify(cfg) !== existing?.value ? 1 : 0) };
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  await db.auditEvent.create({
    data: {
      actor, action: "settings.scoring_updated", entityType: "AppSetting", entityId: KEY,
      detail: JSON.stringify({ version: next.version }),
    },
  });
  return { ok: true, errors: [] };
}
