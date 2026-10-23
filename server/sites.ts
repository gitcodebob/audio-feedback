// Welke websites opnames mogen insturen, en wat er per site van de URL bewaard
// blijft. Staat in <DATA_DIR>/sites.json en wordt beheerd in /admin/sites.
// ALLOWED_ORIGINS vult de lijst alleen bij de allereerste start.

import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { STRICT_URL_OPTIONS, type UrlOptions } from '../widget/src/clean-url.ts';
import { PROJECT, ValidationError } from './validate.ts';

export interface Site extends UrlOptions {
  id: string;
  /** https://app.example.nl, https://*.example.nl (elk subdomein) of * (elke site). */
  origin: string;
  /** Projectnamen die deze site mag gebruiken. Leeg: elke naam. */
  projects: string[];
  createdAt: string;
  updatedAt: string;
}

export type SiteInput = Pick<Site, 'origin' | 'projects' | 'stripQuery' | 'stripHash' | 'keepParams'>;

const WILDCARD = /^(https?:\/\/)\*\.([a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?$/;
const PARAM = /^[A-Za-z0-9_.\-[\]]{1,100}$/;
const MAX_SITES = 200;

/** Ook een geplakt adres met pad wordt een origin; een wildcard blijft een wildcard. */
export function normalizeOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('vul een website in');
  const raw = value.trim().toLowerCase().replace(/\/+$/, '');
  if (raw === '*' || WILDCARD.test(raw)) return raw;
  // Een * die geen geldige wildcard is (https://*.nl, https://a*.nl) is een vergissing, geen hostnaam.
  if (raw.includes('*')) throw new ValidationError(`"${value}": een * mag alleen als https://*.domein.nl`);
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
  } catch {
    // valt door naar de fout
  }
  throw new ValidationError(`"${value}" is geen website; gebruik bijvoorbeeld https://mijn-app.example.nl`);
}

function list(value: unknown, max: number): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out = [...new Set(items.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
  if (out.length > max) throw new ValidationError(`hooguit ${max} tegelijk`);
  return out;
}

export function parseSiteInput(body: unknown): SiteInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const projects = list(b.projects, 20);
  const bad = projects.find((p) => !PROJECT.test(p));
  if (bad) throw new ValidationError(`ongeldige projectnaam "${bad}"; gebruik letters, cijfers, punt, - en _`);
  const keepParams = list(b.keepParams, 50);
  const badParam = keepParams.find((p) => !PARAM.test(p));
  if (badParam) throw new ValidationError(`ongeldige parameter "${badParam}"`);
  return {
    origin: normalizeOrigin(b.origin),
    projects,
    stripQuery: b.stripQuery !== false,
    stripHash: b.stripHash !== false,
    keepParams,
  };
}

/** Hoe specifiek een regel is: een exacte origin gaat voor een wildcard, die gaat voor *. */
function specificity(rule: string, origin: string): number {
  if (rule === origin) return 3;
  const m = WILDCARD.exec(rule);
  if (m && origin.startsWith(m[1]!) && origin.endsWith(`.${m[2]}${m[4] ?? ''}`)) return 2;
  if (rule === '*') return 1;
  return 0;
}

export class SiteStore {
  private sites: Site[] = [];
  private writing: Promise<unknown> = Promise.resolve();
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  /** Leest sites.json. Bestaat die nog niet, dan komt de lijst uit seed ("origin" of "origin=a|b"). */
  async init(seed: string[] = []): Promise<{ seeded: boolean }> {
    try {
      this.sites = JSON.parse(await readFile(this.file, 'utf8')) as Site[];
      return { seeded: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const now = new Date().toISOString();
    for (const entry of seed) {
      const [origin, projects] = entry.split('=', 2) as [string, string | undefined];
      const input = parseSiteInput({ origin, projects: projects?.split('|') ?? [], ...STRICT_URL_OPTIONS });
      if (this.sites.some((s) => s.origin === input.origin)) continue;
      this.sites.push({ id: randomUUID(), ...input, createdAt: now, updatedAt: now });
    }
    await this.persist();
    return { seeded: true };
  }

  list(): Site[] {
    return [...this.sites].sort((a, b) => a.origin.localeCompare(b.origin));
  }

  get(id: string): Site | null {
    return this.sites.find((s) => s.id === id) ?? null;
  }

  /** De site die het best bij deze origin past, of null. */
  match(origin: string): Site | null {
    let best: Site | null = null;
    let score = 0;
    for (const site of this.sites) {
      const s = specificity(site.origin, origin);
      if (s > score) [best, score] = [site, s];
    }
    return best;
  }

  /** Zonder project: mag deze origin überhaupt insturen. Met project: ook onder die naam. */
  allows(origin: string, project?: string): boolean {
    const site = this.match(origin);
    if (!site) return false;
    return project === undefined || site.projects.length === 0 || site.projects.includes(project);
  }

  async create(input: SiteInput): Promise<Site> {
    if (this.sites.length >= MAX_SITES) throw new ValidationError(`hooguit ${MAX_SITES} sites`);
    this.assertUnique(input.origin);
    const now = new Date().toISOString();
    const site: Site = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.sites.push(site);
    await this.persist();
    return site;
  }

  async update(id: string, input: SiteInput): Promise<Site | null> {
    const site = this.get(id);
    if (!site) return null;
    this.assertUnique(input.origin, id);
    Object.assign(site, input, { updatedAt: new Date().toISOString() });
    await this.persist();
    return site;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.sites.length;
    this.sites = this.sites.filter((s) => s.id !== id);
    if (this.sites.length === before) return false;
    await this.persist();
    return true;
  }

  private assertUnique(origin: string, exceptId?: string): void {
    if (this.sites.some((s) => s.origin === origin && s.id !== exceptId)) {
      throw new SiteConflictError(`${origin} staat er al`);
    }
  }

  /** Eén schrijfactie tegelijk, via een tijdelijk bestand: een halve sites.json bestaat nooit. */
  private persist(): Promise<void> {
    const data = `${JSON.stringify(this.sites, null, 2)}\n`;
    const run = this.writing.then(async () => {
      await writeFile(`${this.file}.tmp`, data);
      await rename(`${this.file}.tmp`, this.file);
    });
    this.writing = run.catch(() => {});
    return run;
  }
}

export class SiteConflictError extends Error {}
