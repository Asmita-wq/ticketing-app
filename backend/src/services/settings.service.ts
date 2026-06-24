import { prisma } from '../config/prisma';

const SINGLETON_ID = 'singleton';

export interface AppSettingsInput {
  requireContactPhone?: boolean;
  requireContactEmail?: boolean;
  requireCategory?: boolean;
  requireSubcategory?: boolean;
  requireContactName?: boolean;
  categoryLabel?: string;
  subcategoryLabel?: string;
}

// Fetch the singleton settings row, creating it with defaults if missing.
export async function getSettings() {
  const existing = await prisma.appSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.appSetting.create({ data: { id: SINGLETON_ID } });
}

export async function updateSettings(input: AppSettingsInput) {
  return prisma.appSetting.upsert({
    where: { id: SINGLETON_ID },
    update: input,
    create: { id: SINGLETON_ID, ...input },
  });
}
