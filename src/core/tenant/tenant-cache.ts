import type { Clock } from "../../shared/clock";
import type { TenantLookup, TenantRecord } from "./tenant-context";

const TTL_MS = 30_000;

/** Caches found tenants (by slug and id) for 30 s. Misses are never cached. */
export class CachedTenantLookup implements TenantLookup {
  private readonly bySlug = new Map<string, { record: TenantRecord; expires: number }>();
  private readonly byId = new Map<string, { record: TenantRecord; expires: number }>();

  constructor(
    private readonly source: TenantLookup,
    private readonly clock: Clock,
  ) {}

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.get(this.bySlug, slug, () => this.source.findBySlug(slug));
  }

  async findById(id: string): Promise<TenantRecord | null> {
    return this.get(this.byId, id, () => this.source.findById(id));
  }

  invalidate(): void {
    this.bySlug.clear();
    this.byId.clear();
  }

  private async get(
    map: Map<string, { record: TenantRecord; expires: number }>,
    key: string,
    load: () => Promise<TenantRecord | null>,
  ): Promise<TenantRecord | null> {
    const now = this.clock.now().getTime();
    const hit = map.get(key);
    if (hit && hit.expires > now) return hit.record;
    const record = await load();
    if (!record) return null;
    const entry = { record, expires: now + TTL_MS };
    this.bySlug.set(record.slug, entry);
    this.byId.set(record.id, entry);
    return record;
  }
}
