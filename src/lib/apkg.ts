/**
 * Bridge between the app's { decks, cards } format and Anki's .apkg package.
 * Runs 100% in the browser: jszip for the ZIP container, sql.js (WebAssembly)
 * for the SQLite collection.
 *
 * Supported on import:
 *  - collection.anki21 (preferred) and collection.anki2 (legacy).
 *  - Both the legacy schema (v11: note types/decks as JSON inside `col`) and
 *    the newer split schema (`notetypes`, `fields`, `decks` tables).
 *  - collection.anki21b (zstd-compressed, Anki 2.1.50+ "latest" export) is NOT
 *    supported; such packages usually also ship a stub collection.anki2 that
 *    only contains an "update Anki" note. Re-export from Anki with
 *    "Support older Anki versions" checked.
 *
 * Note types: Basic / Basic (and reversed) / Cloze. Anything else is skipped.
 */
import type { Database, SqlJsStatic } from "sql.js";
import JSZip from "jszip";
// sql.js binary is served statically from public/wasm/ (copied from node_modules/sql.js/dist).
const sqlWasmUrl = "/wasm/sql-wasm.wasm";

export type ApkgDeck = { id: string; name: string; parent_id: string | null };
export type ApkgCard = {
  id: string;
  deck_id: string;
  pergunta: string;
  resposta: string;
  tags: string[];
};
export type ParsedApkg = {
  decks: ApkgDeck[];
  cards: ApkgCard[];
  mediaFiles: Map<string, Blob>;
};

let sqlPromise: Promise<SqlJsStatic> | null = null;
function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = import("sql.js").then((mod) => {
      const init = (mod as unknown as { default: (cfg: object) => Promise<SqlJsStatic> }).default;
      return init({ locateFile: () => sqlWasmUrl });
    });
  }
  return sqlPromise;
}

const FIELD_SEP = "\x1f";

function uuid(): string {
  return crypto.randomUUID();
}

type SqlRow = Partial<
  Record<"id" | "name" | "ntid" | "c" | "models" | "decks" | "mid" | "flds" | "tags" | "ord" | "nid" | "did" | "cid", unknown>
>;

function queryAll(db: Database, sql: string): SqlRow[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0]!;
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])) as SqlRow);
}

function hasTable(db: Database, name: string): boolean {
  const stmt = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  stmt.bind([name]);
  const ok = stmt.step();
  stmt.free();
  return ok;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return queryAll(db, `PRAGMA table_info(${table})`).some((r) => r.name === column);
}

/** Anki HTML -> app text. Keeps <img> tags (media references), turns line breaks into \n. */
function cleanHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<(?!img\b)[^>]+>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Anki cloze -> app cloze.
 * FIDELITY LOSS (accepted): Anki numbers clozes ({{c1::..}}, {{c2::..}}) and
 * generates one card per number, and supports hints ({{c1::text::hint}}).
 * The app only has one un-numbered cloze group, so every deletion collapses
 * into {{c::text}}, hints are dropped, and a note produces a single card.
 */
function convertCloze(text: string): string {
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*?)?\}\}/g, (_m, t: string) => `{{c::${t}}}`);
}

function imgSources(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]*?src\s*=\s*["']?([^"'>\s]+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]!);
  return out;
}

type NoteKind = "basic" | "cloze";
type ModelInfo = { kind: NoteKind | null };

function classifyModel(name: string, type: number | null, fieldCount: number): NoteKind | null {
  const n = name.toLowerCase();
  if (type === 1 || n.includes("cloze") || n.includes("omissão") || n.includes("omissao")) return "cloze";
  if (type !== null && type !== 0) return null;
  if (fieldCount < 2) return null;
  // "Basic", "Basic (and reversed card)", localized variants ("Básico", ...).
  if (/basic|básico|basico|b[aá]sica/.test(n)) return "basic";
  return null;
}

function readModels(db: Database): Map<string, ModelInfo> {
  const models = new Map<string, ModelInfo>();
  if (hasTable(db, "notetypes")) {
    const fieldCounts = new Map<string, number>();
    if (hasTable(db, "fields")) {
      for (const r of queryAll(db, "SELECT ntid, COUNT(*) AS c FROM fields GROUP BY ntid")) {
        fieldCounts.set(String(r.ntid), Number(r.c));
      }
    }
    for (const r of queryAll(db, "SELECT id, name FROM notetypes")) {
      const id = String(r.id);
      models.set(id, { kind: classifyModel(String(r.name), null, fieldCounts.get(id) ?? 2) });
    }
  }
  if (models.size === 0 && hasColumn(db, "col", "models")) {
    const row = queryAll(db, "SELECT models FROM col LIMIT 1")[0];
    const json = row?.models ? JSON.parse(String(row.models)) : {};
    for (const [id, m] of Object.entries<{ name?: string; type?: number; flds?: unknown[] }>(json)) {
      models.set(id, {
        kind: classifyModel(m.name ?? "", m.type ?? 0, m.flds?.length ?? 0),
      });
    }
  }
  return models;
}

function readDeckNames(db: Database): Map<string, string> {
  const names = new Map<string, string>();
  if (hasTable(db, "decks") && hasColumn(db, "decks", "name")) {
    for (const r of queryAll(db, "SELECT id, name FROM decks")) {
      // New schema separates hierarchy levels with \x1f instead of "::".
      names.set(String(r.id), String(r.name).split(FIELD_SEP).join("::"));
    }
  }
  if (names.size === 0 && hasColumn(db, "col", "decks")) {
    const row = queryAll(db, "SELECT decks FROM col LIMIT 1")[0];
    const json = row?.decks ? JSON.parse(String(row.decks)) : {};
    for (const [id, d] of Object.entries<{ name?: string }>(json)) {
      names.set(id, d.name ?? "Sem nome");
    }
  }
  return names;
}

export async function parseApkg(file: File): Promise<ParsedApkg> {
  const zip = await JSZip.loadAsync(file);
  const collectionFile = zip.file("collection.anki21") ?? zip.file("collection.anki2");
  if (!collectionFile) {
    if (zip.file("collection.anki21b")) {
      throw new Error(
        "Formato .apkg recente (anki21b) não suportado. Exporte no Anki marcando 'Suportar versões antigas'.",
      );
    }
    throw new Error("Arquivo .apkg inválido: coleção não encontrada.");
  }

  const SQL = await loadSql();
  const db = new SQL.Database(new Uint8Array(await collectionFile.async("uint8array")));

  try {
    const models = readModels(db);
    const deckNames = readDeckNames(db);

    const rows = queryAll(
      db,
      `SELECT c.id AS cid, c.ord AS ord, c.did AS did, n.id AS nid, n.mid AS mid, n.flds AS flds, n.tags AS tags
       FROM cards c JOIN notes n ON n.id = c.nid ORDER BY n.id, c.ord`,
    );

    // Deck tree: "A::B::C" -> A (root) > B > C.
    const deckByPath = new Map<string, ApkgDeck>();
    const ensureDeck = (fullName: string): ApkgDeck => {
      const parts = fullName.split("::").map((p) => p.trim()).filter(Boolean);
      if (!parts.length) parts.push("Default");
      let parentId: string | null = null;
      let last: ApkgDeck | undefined;
      let path = "";
      for (const part of parts) {
        path = path ? `${path}::${part}` : part;
        let deck = deckByPath.get(path);
        if (!deck) {
          deck = { id: uuid(), name: part, parent_id: parentId };
          deckByPath.set(path, deck);
        }
        parentId = deck.id;
        last = deck;
      }
      return last!;
    };

    const cards: ApkgCard[] = [];
    const referencedMedia = new Set<string>();
    const seenClozeNotes = new Set<string>();

    for (const r of rows) {
      const model = models.get(String(r.mid));
      if (!model?.kind) continue;
      const fields = String(r.flds ?? "").split(FIELD_SEP);
      const tags = String(r.tags ?? "").trim().split(/\s+/).filter(Boolean);
      const ord = Number(r.ord);

      let front: string;
      let back: string;
      if (model.kind === "cloze") {
        const nid = String(r.nid);
        if (seenClozeNotes.has(nid)) continue; // one card per cloze note
        seenClozeNotes.add(nid);
        front = convertCloze(fields[0] ?? "");
        back = fields[1] ?? "";
      } else if (ord === 1) {
        front = fields[1] ?? "";
        back = fields[0] ?? "";
      } else if (ord === 0) {
        front = fields[0] ?? "";
        back = fields[1] ?? "";
      } else {
        continue;
      }

      const pergunta = cleanHtml(front);
      if (!pergunta) continue;
      const resposta = cleanHtml(back);
      for (const src of [...imgSources(pergunta), ...imgSources(resposta)]) referencedMedia.add(src);

      const deck = ensureDeck(deckNames.get(String(r.did)) ?? "Default");
      cards.push({ id: uuid(), deck_id: deck.id, pergunta, resposta, tags });
    }

    // Media: "media" is JSON { "0": "original.jpg", ... } in legacy exports.
    const mediaFiles = new Map<string, Blob>();
    const mediaEntry = zip.file("media");
    if (mediaEntry && referencedMedia.size) {
      let mapping: Record<string, string> = {};
      try {
        mapping = JSON.parse(await mediaEntry.async("string"));
      } catch {
        mapping = {}; // newer protobuf/zstd media index: unsupported, skip media
      }
      for (const [num, name] of Object.entries(mapping)) {
        const decoded = (() => {
          try {
            return decodeURIComponent(name);
          } catch {
            return name;
          }
        })();
        const key = referencedMedia.has(name) ? name : referencedMedia.has(decoded) ? decoded : null;
        if (!key) continue;
        const entry = zip.file(num);
        if (entry) mediaFiles.set(key, await entry.async("blob"));
      }
    }

    return { decks: [...deckByPath.values()], cards, mediaFiles };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const ANKI_SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ivl integer not null, lastIvl integer not null, ease integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

async function checksum(text: string): Promise<number> {
  const plain = text.replace(/<[^>]+>/g, "");
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(plain));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return parseInt(hex.slice(0, 8), 16);
}

function guid(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** App text -> Anki field HTML (preserve line breaks). */
function toFieldHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function extensionFor(url: string, blob: Blob): string {
  const fromUrl = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  const fromType = blob.type.split("/")[1]?.split("+")[0];
  return fromType || "png";
}

export async function buildApkg(
  decks: { id: string; name: string; parent_id: string | null }[],
  cards: {
    id: string;
    deck_id: string;
    pergunta: string;
    resposta: string;
    tags: string[];
    image_url?: string | null;
  }[],
): Promise<Blob> {
  const SQL = await loadSql();
  const db = new SQL.Database();
  const zip = new JSZip();

  try {
    db.run(ANKI_SCHEMA);
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    // Full "A::B::C" names from the parent_id chain.
    const byId = new Map(decks.map((d) => [d.id, d]));
    const fullName = (id: string): string => {
      const parts: string[] = [];
      const seen = new Set<string>();
      let cur = byId.get(id);
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name.replace(/::/g, ":"));
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return parts.join("::") || "Default";
    };

    const deckTemplate = (id: number, name: string) => ({
      id,
      name,
      mod: nowSec,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 0,
      extendRev: 0,
    });

    const ankiDeckIds = new Map<string, number>();
    const decksJson: Record<string, unknown> = { "1": deckTemplate(1, "Default") };
    decks.forEach((d, i) => {
      const aid = nowMs + i + 1;
      ankiDeckIds.set(d.id, aid);
      decksJson[String(aid)] = deckTemplate(aid, fullName(d.id));
    });

    const modelId = nowMs;
    const firstDeck = ankiDeckIds.values().next().value ?? 1;
    const model = {
      id: modelId,
      name: "Basic",
      type: 0,
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: firstDeck,
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
          did: null,
          bqfmt: "",
          bafmt: "",
        },
      ],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      ],
      css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
      latexPre:
        "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      latexsvg: false,
      req: [[0, "any", [0]]],
      tags: [],
      vers: [],
    };

    const dconf = {
      "1": {
        id: 1,
        name: "Default",
        mod: 0,
        usn: 0,
        maxTaken: 60,
        autoplay: true,
        timer: 0,
        replayq: true,
        dyn: false,
        new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, order: 1, perDay: 20, bury: false },
        lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
        rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2 },
      },
    };

    const conf = {
      activeDecks: [1],
      curDeck: 1,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      curModel: String(modelId),
      nextPos: cards.length + 1,
      sortType: "noteFld",
      sortBackwards: false,
      addToCur: true,
    };

    // Media: download every image_url once, store as numbered zip entries.
    const media: Record<string, string> = {};
    const mediaNameByUrl = new Map<string, string>();
    let mediaIndex = 0;
    for (const card of cards) {
      const url = card.image_url;
      if (!url || mediaNameByUrl.has(url)) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const name = `img_${mediaIndex}_${card.id.slice(0, 8)}.${extensionFor(url, blob)}`;
        zip.file(String(mediaIndex), blob);
        media[String(mediaIndex)] = name;
        mediaNameByUrl.set(url, name);
        mediaIndex++;
      } catch {
        // Unreachable image: export the card without it.
      }
    }

    const allTags = new Set<string>();
    const noteStmt = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const cardStmt = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]!;
      const did = ankiDeckIds.get(c.deck_id) ?? 1;
      const front = toFieldHtml(c.pergunta);
      let back = toFieldHtml(c.resposta);
      const imgName = c.image_url ? mediaNameByUrl.get(c.image_url) : undefined;
      if (imgName) back += `${back ? "<br>" : ""}<img src="${imgName}">`;

      const tags = c.tags.map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean);
      tags.forEach((t) => allTags.add(t));

      const noteId = nowMs + 100000 + i;
      const cardId = nowMs + 200000 + i;
      noteStmt.run([
        noteId,
        guid(),
        modelId,
        nowSec,
        -1,
        tags.length ? ` ${tags.join(" ")} ` : "",
        `${front}${FIELD_SEP}${back}`,
        front.replace(/<[^>]+>/g, ""),
        await checksum(front),
        0,
        "",
      ]);
      cardStmt.run([cardId, noteId, did, 0, nowSec, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
    }
    noteStmt.free();
    cardStmt.free();

    // Legacy (v11) schema keeps tags as a JSON registry in col.tags.
    const tagsJson = Object.fromEntries([...allTags].map((t) => [t, 0]));

    db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)", [
      nowSec,
      nowMs,
      nowMs,
      JSON.stringify(conf),
      JSON.stringify({ [String(modelId)]: model }),
      JSON.stringify(decksJson),
      JSON.stringify(dconf),
      JSON.stringify(tagsJson),
    ]);

    zip.file("collection.anki2", db.export());
    zip.file("media", JSON.stringify(media));

    return await zip.generateAsync({ type: "blob", mimeType: "application/apkg" });
  } finally {
    db.close();
  }
}
