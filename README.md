# herdr-mod-github

herdr-app の Mod。フォーカス中ペインのリポジトリの PR と Issue を `gh` で一覧表示する(`gh` にログイン済みであること)。

- タブ: PRs(自分の PR とレビュー待ちを 1 本にまとめ、各行に `mine` / `review` を表示)/ Issues(自分にアサイン)
- 行をクリック、または Enter でブラウザで開く
- レビュー待ちの PR の `review` ボタン: 新しいタブで `wt-review <番号>` を実行
- Issues タブの `claude` ボタン: 新しいタブで claude に Issue を渡す
- ←/→ タブ切替、↑/↓ 移動、^R 再読込、Esc 閉じる
- popup(`mod.json` の overlay)でも、右パネルのブロックとしても使える

## 導入

    ln -s ~/Projects/herdr-mods/github ~/.config/herdr-app/mods/github
    herdr-app check ~/.config/herdr-app/mods/github

パネルに載せるには、layout の stack に `{ "id": "github", "type": "block", "content": { "mod": "github" } }` を追加する。

## Storybook

`storybook.json` と `main.js` 内のモックで、ModsStoryBook から表示状態(空・多数・エラーなど)を切り替えられる。
