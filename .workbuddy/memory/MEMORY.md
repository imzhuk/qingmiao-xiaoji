# 青苗小记-网页版 · 项目长期笔记

## 部署信息
- 线上地址：https://imzhuk.cn（备用 http://，www 自动跳转）
- 托管：GitHub Pages，仓库 `imzhuk/qingmiao-xiaoji`（main 分支根目录部署）
- 域名：imzhuk.cn，注册于西部数码（west.cn）；DNS 有 @ 的 4 条 A 记录（185.199.108-111.153）和 www 的 CNAME → imzhuk.github.io
- 仓库内有 CNAME 文件（内容 imzhuk.cn），更新域名需同步改它并推送
- 本地工作区是独立 git 仓库（不要动外层 C:/Users/zk 的误建仓库）；推送用 HTTPS + Windows 凭据管理器，用户名 imzhuk
- 注意：在 GitHub Pages 设置页手动改 Custom domain 会自动产生 CNAME 提交，与本地推送冲突时以本地为准 force push
