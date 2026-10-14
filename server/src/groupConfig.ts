import { readFile } from "fs/promises";
import { resolve } from "path";
import { AdminApiError } from "./anthropicAdmin.js";
import { getRbacCredential, getRbacGroupMembers, getRbacGroups, getRbacRoles } from "./anthropicAdmin.js";
import { config } from "./config.js";

export interface GroupConfigEntry {
  groupId: string;
  name: string;
  members: Array<{
    userId?: string;
    email?: string | null;
  }>;
  sourceType?: string | null;
  roleIds?: string[];
  roleNames?: string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: GroupConfigEntry[] | null = null;
let cachedAt = 0;

function pushWarning(warnings: string[] | undefined, message: string): void {
  if (!warnings) return;
  if (!warnings.includes(message)) warnings.push(message);
}

function formatLiveGroupConfigError(err: unknown): string {
  if (err instanceof AdminApiError) {
    const credential = getRbacCredential();
    if (err.status === 403 && err.body.includes("read:rbac_groups")) {
      return `${credential.envVar} is missing the \`read:rbac_groups\` scope, so group memberships and roles cannot be shown in the dashboard.`;
    }
    return `Claude Admin API returned ${err.status} while loading groups, so group memberships and roles are unavailable.`;
  }

  return `Failed to load Claude Admin groups: ${err instanceof Error ? err.message : String(err)}`;
}

function isCacheFresh(now = Date.now()): boolean {
  return cached !== null && now - cachedAt < CACHE_TTL_MS;
}

async function loadLocalGroupConfig(): Promise<GroupConfigEntry[]> {
  try {
    const path = resolve(process.cwd(), "groups.json");
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      console.warn("[groups] groups.json must be a JSON array — ignoring");
      return [];
    }
    const localGroups = parsed as Array<{ name?: string; emails?: string[] }>;
    return localGroups
      .filter((group) => typeof group.name === "string" && Array.isArray(group.emails))
      .map((group) => ({
        groupId: group.name!,
        name: group.name!,
        members: (group.emails ?? []).map((email) => ({ email })),
      }));
  } catch (err: unknown) {
    // ENOENT is expected when the file hasn't been created yet; silence it.
    if ((err as { code?: string }).code !== "ENOENT") {
      console.warn("[groups] Failed to read groups.json:", (err as Error).message);
    }
    return [];
  }
}

async function loadLiveGroupConfig(): Promise<GroupConfigEntry[]> {
  const [groups, roles] = await Promise.all([getRbacGroups(), getRbacRoles()]);
  const roleNamesById = new Map(roles.map((role) => [role.roleId, role.name] as const));
  const groupsWithMembers = await Promise.all(
    groups.map(async (group) => ({
      groupId: group.groupId,
      name: group.name,
      sourceType: group.sourceType,
      roleIds: group.roleIds,
      roleNames: group.roleIds.map((roleId) => roleNamesById.get(roleId) ?? roleId),
      members: (await getRbacGroupMembers(group.groupId)).map((member) => ({
        userId: member.userId,
        email: member.email,
      })),
    })),
  );

  console.log(`[groups] Loaded ${groupsWithMembers.length} group(s) from Claude Enterprise Admin API`);
  return groupsWithMembers;
}

export async function loadGroupConfig(warnings?: string[]): Promise<GroupConfigEntry[]> {
  if (isCacheFresh()) return cached!;

  try {
    if (config.adminKey || config.analyticsKey) {
      cached = await loadLiveGroupConfig();
      cachedAt = Date.now();
      return cached;
    }
  } catch (err: unknown) {
    pushWarning(warnings, formatLiveGroupConfigError(err));
    console.warn("[groups] Failed to read live Claude Enterprise groups, falling back to groups.json:", (err as Error).message);
  }

  cached = await loadLocalGroupConfig();
  cachedAt = Date.now();
  if (cached.length > 0) {
    console.log(`[groups] Loaded ${cached.length} group(s) from groups.json`);
  }
  return cached;
}

/** Call on server startup to warm the cache eagerly (optional). */
export async function preloadGroupConfig(): Promise<void> {
  await loadGroupConfig();
}
