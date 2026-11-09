// GitHub: PRs and issues of the focused pane's repo (via gh, already logged in).
// Tabs: PRs (my PRs + review requested, each row tagged "mine" / "review") · Issues (assigned to me).
// Row: click = open in browser · "review" = wt-review <n> in a new tab · issue "claude" = new tab, claude gets the issue.
// ←/→ switch tab, ↑/↓ move, Enter open, Esc close.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, theme, props, closeOverlay, shared } from "herdr";

// gh から取る一覧(mine と review は表示では PRs に統合する)
const SOURCES = [
  { id: "mine", kind: "pr", args: ["--author", "@me"] },
  { id: "review", kind: "pr", args: ["--search", "review-requested:@me"] },
  { id: "issues", kind: "issue", args: ["--assignee", "@me"] },
];
const TABS = [
  { id: "prs", label: "PRs", kind: "pr" },
  { id: "issues", label: "Issues", kind: "issue" },
];
// 自分の PR とレビュー待ちを 1 本にし、各行に roles("mine" / "review")を付ける
function merge(raw) {
  const byNum = new Map();
  for (const role of ["mine", "review"]) {
    for (const r of raw[role] ?? []) {
      const cur = byNum.get(r.number);
      if (cur) cur.roles.push(role); else byNum.set(r.number, { ...r, roles: [role] });
    }
  }
  const prs = [...byNum.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { prs, issues: raw.issues ?? [] };
}
const PR_FIELDS = "number,title,author,isDraft,reviewDecision,statusCheckRollup,headRefName,url,updatedAt";
const ISSUE_FIELDS = "number,title,labels,url,updatedAt";

// ---- Storybook 用モック(状態を変えたら storybook.json も同時に直す)----
const now = Date.now();
const minsAgo = (min) => new Date(now - min * 60000).toISOString();
const ck = (conclusion, status = "COMPLETED") => [{ conclusion, status }];

const PR_TITLES = [
  "Add dark mode toggle to settings", "Fix crash when opening empty repo", "Refactor auth middleware",
  "Bump dependencies", "Improve startup time", "Docs: clarify install steps", "Handle rate limit errors",
];
const pr = (n, title, o = {}) => ({
  number: n, title, author: { login: o.author ?? "octocat" }, isDraft: Boolean(o.draft),
  reviewDecision: o.review ?? "", statusCheckRollup: o.checks ?? [], headRefName: `feat/${n}`,
  url: `https://github.com/mock/repo/pull/${n}`, updatedAt: minsAgo(o.min ?? 30),
});
const issue = (n, title, o = {}) => ({
  number: n, title, labels: (o.labels ?? []).map((name) => ({ name })),
  url: `https://github.com/mock/repo/issues/${n}`, updatedAt: minsAgo(o.min ?? 120),
});

const FEW = {
  mine: [
    pr(128, "Add dark mode toggle to settings", { checks: ck("SUCCESS"), review: "APPROVED", min: 12 }),
    pr(127, "Fix crash when opening empty repo", { checks: ck("FAILURE"), review: "CHANGES_REQUESTED", min: 200 }),
    pr(125, "Refactor auth middleware", { checks: ck("", "IN_PROGRESS"), draft: true, min: 1500 }),
    pr(120, "Docs: clarify install steps", { min: 6000 }),
  ],
  review: [
    pr(131, "Handle rate limit errors", { author: "alice", checks: ck("SUCCESS"), min: 45 }),
    pr(129, "Improve startup time", { author: "bob", checks: ck("", "QUEUED"), min: 400 }),
  ],
  issues: [
    issue(77, "Panel layout overflows on narrow width", { labels: ["bug"], min: 60 }),
    issue(75, "Support GitHub Enterprise hosts", { labels: ["enhancement"], min: 3000 }),
    issue(70, "Show CI status for issues", { min: 9000 }),
  ],
};

const LONG = "Implement a very long-running background synchronization pipeline that reconciles remote state with the local cache across every configured machine and workspace";
const LONGS = {
  mine: [pr(300, LONG, { checks: ck("SUCCESS"), review: "APPROVED", author: "a-very-long-author-login-name" }), pr(299, "日本語のとても長いタイトルの例: ワークスペースの並べ替えとタブの復元処理を全面的に見直して安定化する", { draft: true })],
  review: [pr(301, LONG, { author: "a-very-long-author-login-name", checks: ck("FAILURE") })],
  issues: [issue(88, LONG, { labels: ["bug", "help wanted"] })],
};

const many = (kind) => Array.from({ length: 30 }, (_, i) => {
  const n = 200 - i, t = `${PR_TITLES[i % PR_TITLES.length]} (${n})`;
  return kind === "issues" ? issue(n, t, { min: 20 + i * 90 })
    : pr(n, t, { checks: ck(["SUCCESS", "FAILURE", ""][i % 3], i % 3 === 2 ? "IN_PROGRESS" : "COMPLETED"), draft: i % 5 === 0, review: i % 4 === 0 ? "APPROVED" : "", min: 20 + i * 90 });
});

const EMPTY = { mine: [], review: [], issues: [] };

// dataset → { data, loaded, error }
function mockState(dataset) {
  switch (dataset) {
    case "empty": return { data: EMPTY, loaded: true, error: null };
    case "many": return { data: { mine: many("pr"), review: many("pr"), issues: many("issues") }, loaded: true, error: null };
    case "long": return { data: LONGS, loaded: true, error: null };
    case "loading": return { data: {}, loaded: false, error: null };
    case "error": return { data: {}, loaded: true, error: "To get started with GitHub CLI, please run:  gh auth login" };
    case "norepo": return { data: {}, loaded: true, error: "Not a git repository" };
    default: return { data: FEW, loaded: true, error: null };
  }
}
// ---- /モック ----

// モック中(Story が開いたプレビュー)は選択値、本番なら null(契約 v2: ModsStoryBook/STORYBOOK.md)
const DEFAULTS = { dataset: "few", tab: "0", panel: false }; // storybook.json の default と揃える
function storybook(mod) {
  const id = props()?.storybook;
  return id ? { ...DEFAULTS, ...(shared(`storybook:${mod}:${id}`)?.values ?? {}) } : null;
}

function cwd() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const space = spaces().find((s) => s.active);
  return { dir: pane?.cwd || f?.cwd || space?.folder, on: space?.machine ?? null };
}
const ago = (iso) => {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
};
function checks(roll) {
  if (!roll?.length) return null;
  const bad = roll.some((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(c.conclusion) || c.state === "FAILURE" || c.state === "ERROR");
  const wait = roll.some((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING");
  return bad ? "fail" : wait ? "pending" : "pass";
}

export default class Github extends View {
  init(_props, cx) {
    this.tab = 0; this.at = 0; this.data = {};
    this.handle = cx.focus_handle(); this.cx = cx;
    if (storybook("github")) { this.wasMock = true; return; }
    ({ dir: this.dir, on: this.on } = cwd());
    this.load(cx);
  }

  // モック中は本番データを使わず、mock.js の値で描画する
  view() {
    const sb = storybook("github");
    if (sb) {
      const key = `${sb.dataset}|${sb.tab}`;
      if (key !== this.mockKey) { this.mockKey = key; this.tab = Number(sb.tab ?? 0); this.at = 0; }
      const m = mockState(sb.dataset ?? "few");
      return { sb, root: "mock-repo", ...m, data: merge(m.data) };
    }
    return { sb: null, root: this.root, data: merge(this.data), loaded: this.loaded, error: this.error };
  }

  load(cx) {
    const dir = this.dir;
    if (!dir) { this.error = "No folder"; return; }
    cx.spawn(async (cx) => {
      const out = {};
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir, on: this.on });
        if (top.code !== 0) throw new Error("Not a git repository");
        this.root = top.stdout.trim();
        await Promise.all(SOURCES.map(async (t) => {
          const args = [t.kind, "list", ...t.args, "--limit", "30", "--json", t.kind === "pr" ? PR_FIELDS : ISSUE_FIELDS];
          const r = await exec("gh", args, { cwd: this.root, on: this.on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
          out[t.id] = JSON.parse(r.stdout);
        }));
        this.error = null;
      } catch (e) { this.error = String(e.message ?? e); }
      this.data = out;
      this.loaded = true;
      cx.notify();
    });
  }

  rows(v) { return v.data[TABS[this.tab].id] ?? []; }
  get popup() { const sb = storybook("github"); return sb ? !sb.panel : Boolean(props()?.overlay); }
  close() { if (!storybook("github") && this.popup) closeOverlay(props()?.overlay); }

  note(msg) { this.noteText = msg; this.cx?.notify(); }
  open(r) { if (storybook("github")) return this.note(`(mock) open #${r.number}`); exec("open", [r.url]); }
  review(r) { if (storybook("github")) return this.note(`(mock) wt-review ${r.number}`); this.close(); run("tab.new", { name: `review #${r.number}`, folder: this.root, argv: ["wt-review", String(r.number)] }); }
  claude(r) {
    if (storybook("github")) return this.note(`(mock) claude #${r.number}`);
    this.close();
    run("tab.new", { name: `#${r.number}`, folder: this.root, argv: ["claude"], task: `GitHub Issue #${r.number}「${r.title}」を gh issue view ${r.number} で読み、対応方針を提案してください。` });
  }

  btn(t, id, label, fn) {
    return div().id(id).px(8).py(2).rounded(5).text_size(11).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((e, cx) => { cx.stop_propagation(); fn(); }).child(label);
  }

  render(cx) {
    const t = theme();
    const tab = TABS[this.tab];
    if (!storybook("github") && this.wasMock) { this.wasMock = false; ({ dir: this.dir, on: this.on } = cwd()); this.load(cx); }
    const v = this.view();
    if (v.sb) this.wasMock = true;
    const rows = this.rows(v);
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const repo = v.root ? v.root.split("/").pop() : "";
    return v_flex().id("github").track_focus(this.handle).w_full().min_h(0).p(this.popup ? 18 : 10).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "right") { this.tab = (this.tab + 1) % TABS.length; this.at = 0; }
        else if (k === "left") { this.tab = (this.tab + TABS.length - 1) % TABS.length; this.at = 0; }
        else if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "enter") { if (rows[this.at]) this.open(rows[this.at]); return; }
        else if (k === "r" && e.modifiers.control) { if (v.sb) return; this.loaded = false; this.load(cx); }
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("GitHub"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(repo))
        .child(div().text_size(11).text_color(t.dim).child(this.popup ? "←→ tab · ↑↓ · ⏎ open · ^R reload" : "^R reload")))
      .child(h_flex().gap(4).flex_wrap().children(TABS.map((x, i) =>
        h_flex().id(`gh-t-${x.id}`).px(this.popup ? 10 : 8).h(28).gap(6).items_center().rounded(7).cursor_pointer()
          .when(i === this.tab, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .text_color(i === this.tab ? t.foreground : t.muted)
          .on_click((_e, cx) => { this.tab = i; this.at = 0; cx.notify(); })
          .child(x.label).child(div().text_size(11).text_color(t.dim).child(String((v.data[x.id] ?? []).length))))))
      .child(v_flex().id("gh-list").h(Math.max(80, Math.min(380, rows.length * 36 + 8))).min_h(0).overflow_y_scrollbar()
        .when(!v.loaded && !v.error, (el) => el.child(div().p(10).text_color(t.dim).child("Loading…")))
        .when(Boolean(v.error), (el) => el.child(div().p(10).text_color(t.blocked).child(v.error)))
        .when(v.loaded && !v.error && rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("Nothing here")))
        .children(rows.map((r, i) => {
          const c = tab.kind === "pr" ? checks(r.statusCheckRollup) : null;
          const cc = c === "fail" ? t.blocked : c === "pending" ? t.working : c === "pass" ? t.done : t.dim;
          return h_flex().id(`gh-${i}`).mx(4).px(this.popup ? 10 : 6).h(36).flex_none().gap(this.popup ? 10 : 6).rounded(7).items_center().cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
            .on_click(() => this.open(r))
            .child(div().w(this.popup ? 46 : 38).flex_none().text_color(t.dim).child(`#${r.number}`))
            .when(tab.kind === "pr", (el) => el.child(div().w(10).flex_none().text_color(cc).child(c ? "●" : "○")))
            .child(div().flex_1().truncate().text_color(t.foreground).child(r.title))
            .when(tab.kind === "pr", (el) => el.child(div().text_size(11).text_color(r.roles.includes("review") ? t.working : t.dim).child(r.roles.includes("review") ? "review" : "mine")))
            .when(r.isDraft, (el) => el.child(div().text_size(11).text_color(t.dim).child("draft")))
            .when(r.reviewDecision === "APPROVED", (el) => el.child(div().text_size(11).text_color(t.done).child("approved")))
            .when(r.reviewDecision === "CHANGES_REQUESTED", (el) => el.child(div().text_size(11).text_color(t.blocked).child("changes")))
            .when(this.popup && tab.kind === "pr" && r.author?.login, (el) => el.child(div().text_size(11).text_color(t.dim).child(r.author.login)))
            .child(div().w(28).flex_none().text_size(11).text_color(t.dim).child(ago(r.updatedAt)))
            .when(tab.kind === "pr" && r.roles.includes("review"), (el) => el.child(this.btn(t, `gh-r-${i}`, "review", () => this.review(r))))
            .when(tab.kind === "issue", (el) => el.child(this.btn(t, `gh-c-${i}`, "claude", () => this.claude(r))));
        })))
      .when(Boolean(v.sb && this.noteText), (el) => el.child(div().text_size(11).text_color(t.dim).child(this.noteText)));
  }
}
