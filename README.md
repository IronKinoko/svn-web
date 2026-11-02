# SVN Desk

一个用于浏览远程 SVN 仓库目录结构的浏览器应用。左侧保存常用仓库地址，右侧按需展示远程目录树。

## 使用方式

- 添加一个 `http`、`https`、`svn` 或 `svn+ssh` 地址，可同时填写 SVN 登录用户名和密码，然后选择它查看仓库根目录。
- 展开尚未缓存的目录时，后端调用容器内的 `svn list` 读取子目录。每次成功读取的目录条目和展开路径都会保存到后端 JSON 缓存。
- 目录列表会显示每个文件或目录在 SVN 中的最后提交时间。
- 文件夹右键菜单可以收藏当前目录。收藏项会显示在侧边栏对应地址下方，点击后直接从该目录展开浏览，悬停可删除收藏。
- 文件右键菜单提供“查看改动历史”；历史页左侧按修订展开该提交涉及的全部文件，点击文件后右侧使用 CodeMirror 对比选中版本与上一版本，并按行高亮新增、删除和修改内容。差异视图支持左右分栏与单窗口统一视图切换。
- 再次打开地址时，前端一次读取整份后端快照，直接恢复已读取的目录树和展开状态；只有快照中缺失的目录才会按需访问 SVN。
- 点击“刷新远程目录”会清除当前地址的服务端缓存，再从远程仓库重新读取根目录。
- 地址名称、URL、用户名和密码保存在后端数据目录的 `locations.json` 中，浏览器刷新或更换浏览器后仍会保留；密码不会加密。
- 地址列表接口不会把已保存的密码回传给浏览器。读取 SVN 目录时，后端按地址记录使用保存的密码；编辑时密码留空会保留原密码。登录凭据不会拼接到 SVN URL 中。
- 如果浏览器中还有旧版保存的地址，首次打开新版时会自动迁移到后端，并清除浏览器中的旧地址和凭据记录。

## 本地开发

```sh
pnpm install
pnpm dev
```

API 默认运行在 `http://localhost:3000`，Vite 开发服务器代理 `/api` 请求到该端口。

文件图标由 Vite 插件直接从 `material-icon-theme` 依赖读取：开发服务器按需提供，生产构建时写入 `dist/client/material-icons`，无需安装后的复制步骤。

## Docker

```sh
docker compose up --build
```

然后打开 `http://localhost:50001`。可用 `APP_PORT` 修改宿主机端口，容器内服务仍监听 `3000`。容器需要能够访问配置的 SVN 服务器。

地址记录和目录快照都保存在 Docker named volume `svn-desk-data` 中，容器重建后仍会保留。`locations.json` 保存地址、用户名和密码（文件权限 `0600`，不加密），`tree-cache.json` 保存目录条目和展开路径。若需清除所有记录，可删除该 Docker volume。

## API

- `GET /api/health`：服务健康状态
- `GET /api/remote/locations`：读取后端地址记录，不返回密码，仅返回 `hasPassword`
- `POST /api/remote/locations`：新增后端地址记录
- `PUT /api/remote/locations/:locationId`：更新后端地址记录；省略 `password` 时保留原密码
- `PUT /api/remote/locations/:locationId/favorites`：更新该地址下收藏的目录列表
- `DELETE /api/remote/locations/:locationId`：删除地址记录及对应目录快照
- `POST /api/remote/tree`：JSON 请求体包含 `locationId`、`url`、`path`、`username`，后端使用已保存密码列出远程目录直接子项并更新快照
- `POST /api/remote/file`：JSON 请求体包含 `locationId`、`url`、`path`、`username`，可传 `revision` 读取指定修订版本及上一版本供前端逐行对比
- `POST /api/remote/file/history`：读取文件修订历史及每个修订涉及的变更文件，可使用 `beforeRevision` 分页加载更早记录
- `POST /api/remote/cache/read`：读取指定地址的完整目录快照
- `PUT /api/remote/cache/expanded`：更新指定地址的展开路径
- `DELETE /api/remote/cache/:locationId`：清除指定地址的目录快照

远程目录通过参数化的 `svn list --xml --depth immediates` 调用读取，不经 shell 执行。服务只接受 `http`、`https`、`svn` 和 `svn+ssh` 协议。

不要把未加认证的管理界面暴露到不可信网络。
