# 原生迁移验收状态

目标：Expo / React Native 正式 iOS App，电脑保留 HTML；两端同步同一账本；GitHub Actions macOS 构建真机 IPA。

当前移动端为原生组件，不使用 WebView。SQLite 离线账本、账户、交易新增/修改/删除、转账、文本账单解析与重复检查、旧 JSON 导入、JSON 分享备份已实现。原图标采用微软 Fluent Emoji Flat，矢量路径与现有网页保持一致。

金额内部为整数分；负债为负余额、待还金额以正数显示。旧版负债正/负两种记法导入统一为负余额。账户当前余额不依赖重复累计写入，期初余额加交易流量计算。投资未录成本不显示浮盈。

## 已验证

- 17 项 core tests：金额、余额、旧数据导入、投资成本、账单去重、年度复盘、增量队列、冲突与删除标记及上传时继续编辑。
- 本地 PostgreSQL 引擎运行迁移通过；验证账号隔离、禁止直接写表、版本检查、重复请求幂等及删除标记。未部署到线上 Supabase。
- 本地账本修改与待上传队列写入同一条 SQLite 记录，保存失败时不显示成功。同步网络连接尚未接通。
- TypeScript 类型检查通过。
- iOS Metro/Hermes 生产包导出成功；这不等于 Xcode 真机编译成功。
- 首轮 GitHub Actions macOS 真机归档、arm64 / bundle ID 检查及未签名 IPA 上传成功：[构建记录](https://github.com/MRaindropR/ledger/actions/runs/37089393987)。这一产物基于 d290b5c，后续新增模块须重新构建。

## 未完成，必须继续

- 新增模块的 GitHub Actions 构建，以及 IPA 自签后安装验证。
- 原生界面真机交互、键盘和文件分享验证。
- 手机/HTML 的账号认证、增量同步、离线补传、删除标记、冲突处理和双端联调。
- 电脑 HTML 共用新账本格式与同步协议；当前桌面文件未改。
- 原生 Excel/CSV 导入、分类学习、预算、完整图表、账户明细、完整排序和对账体验。年度复盘已增加收支、结余率、月度支出和分类汇总，尚待真机验证。
- 大账本虚拟列表、币种/汇率汇总、导入覆盖的自动安全备份、撤销机制。
- App 图标/启动页和发布配置完善，隐私政策、依赖与上线安全检查。

## 构建与测试

```sh
cd mobile
npm ci
npm run typecheck
npm test
npm run test:database
npm run export:ios
```

Actions 页面运行 `iOS Native Build`。真机 `.ipa` 尚未签名，不能直接安装，下载后在本机使用签名工具；Apple ID 不进入 CI。将来 TestFlight / App Store 使用独立签名流程，不把个人证书放进源码。

## 同步迁移原则

旧 Supabase `sync_data` 为整份 JSON 覆盖，不能直接复用为长期双端协议。新服务须使用每笔数据唯一 ID、每条服务端版本和原子 compare-and-set；账户余额从交易计算，避免两台设备新增交易时互相覆盖账户余额。未处理的冲突显式阻止上传，删除使用 tombstone，离线队列持久化。登录身份由 Supabase Auth 管理，行级权限按账本成员限定；管理员 key 不进入手机或 HTML。

生产账本数据、登录会话、签名证书不提交 GitHub。根目录 index.html 为仓库现有网页版本，暂未替换。

## 依赖安全

官方 SDK 57 模板依赖树的审计发现构建工具中的 braces / node-forge / xcode→uuid 告警。不能采用 npm audit 建议的 Expo 44 / RN 0.72 降级；须检查兼容补丁与使用路径，在正式发布前复查。当前并非“安全审计已通过”。
