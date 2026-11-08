// GitHub: PRs and issues of the focused pane's repo (via gh, already logged in).
// Tabs: Mine (my PRs) · Review (review requested) · Issues (assigned to me, else open).
// Row: click = open in browser · "review" = wt-review <n> in a new tab · issue "claude" = new tab, claude gets the issue.
// ←/→ switch tab, ↑/↓ move, Enter open, Esc close.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, theme, props, closeOverlay } from "herdr";

const TABS = [
  { id: "mine", label: "My PRs", kind: "pr", args: ["--author", "@me"] },
  { id: "review", label: "Review", kind: "pr", args: ["--search", "review-requested:@me"] },
  { id: "issues", label: "Issues", kind: "issue", args: ["--assignee", "@me"] },
];
const PR_FIELDS = "number,title,author,isDraft,reviewDecision,statusCheckRollup,headRefName,url,updatedAt";
const ISSUE_FIELDS = "number,title,labels,url,updatedAt";

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
    this.tab = 0; this.at = 0; this.data = {}; ({ dir: this.dir, on: this.on } = cwd());
    this.handle = cx.focus_handle();
    this.load(cx);
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
        await Promise.all(TABS.map(async (t) => {
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

  rows() { return this.data[TABS[this.tab].id] ?? []; }
  close() { closeOverlay(props().overlay); }

  open(r) { exec("open", [r.url]); }
  review(r) { this.close(); run("tab.new", { name: `review #${r.number}`, folder: this.root, argv: ["wt-review", String(r.number)] }); }
  claude(r) {
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
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const repo = this.root ? this.root.split("/").pop() : "";
    return v_flex().id("github").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "right") { this.tab = (this.tab + 1) % TABS.length; this.at = 0; }
        else if (k === "left") { this.tab = (this.tab + TABS.length - 1) % TABS.length; this.at = 0; }
        else if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "enter") { if (rows[this.at]) this.open(rows[this.at]); return; }
        else if (k === "r" && e.modifiers.control) { this.loaded = false; this.load(cx); }
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("GitHub"))
        .child(div().text_color(t.dim).child(repo))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("←→ tab · ↑↓ · ⏎ open · ^R reload")))
      .child(h_flex().gap(4).children(TABS.map((x, i) =>
        h_flex().id(`gh-t-${x.id}`).px(10).h(28).gap(6).items_center().rounded(7).cursor_pointer()
          .when(i === this.tab, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .text_color(i === this.tab ? t.foreground : t.muted)
          .on_click((_e, cx) => { this.tab = i; this.at = 0; cx.notify(); })
          .child(x.label).child(div().text_size(11).text_color(t.dim).child(String((this.data[x.id] ?? []).length))))))
      .child(v_flex().id("gh-list").h(Math.max(80, Math.min(380, rows.length * 36 + 8))).min_h(0).overflow_y_scrollbar()
        .when(!this.loaded && !this.error, (el) => el.child(div().p(10).text_color(t.dim).child("Loading…")))
        .when(Boolean(this.error), (el) => el.child(div().p(10).text_color(t.blocked).child(this.error)))
        .when(this.loaded && !this.error && rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("Nothing here")))
        .children(rows.map((r, i) => {
          const c = tab.kind === "pr" ? checks(r.statusCheckRollup) : null;
          const cc = c === "fail" ? t.blocked : c === "pending" ? t.working : c === "pass" ? t.done : t.dim;
          return h_flex().id(`gh-${i}`).mx(4).px(10).h(36).flex_none().gap(10).rounded(7).items_center().cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
            .on_click(() => this.open(r))
            .child(div().w(46).flex_none().text_color(t.dim).child(`#${r.number}`))
            .when(tab.kind === "pr", (el) => el.child(div().w(10).flex_none().text_color(cc).child(c ? "●" : "○")))
            .child(div().flex_1().truncate().text_color(t.foreground).child(r.title))
            .when(r.isDraft, (el) => el.child(div().text_size(11).text_color(t.dim).child("draft")))
            .when(r.reviewDecision === "APPROVED", (el) => el.child(div().text_size(11).text_color(t.done).child("approved")))
            .when(r.reviewDecision === "CHANGES_REQUESTED", (el) => el.child(div().text_size(11).text_color(t.blocked).child("changes")))
            .when(tab.kind === "pr" && r.author?.login, (el) => el.child(div().text_size(11).text_color(t.dim).child(r.author.login)))
            .child(div().w(28).flex_none().text_size(11).text_color(t.dim).child(ago(r.updatedAt)))
            .when(tab.kind === "pr" && tab.id === "review", (el) => el.child(this.btn(t, `gh-r-${i}`, "review", () => this.review(r))))
            .when(tab.kind === "issue", (el) => el.child(this.btn(t, `gh-c-${i}`, "claude", () => this.claude(r))));
        })));
  }
}
