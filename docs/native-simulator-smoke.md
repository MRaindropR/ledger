# iOS 原生模拟器验收

工作流 `iOS Native Build` 新增 `smoke-simulator` 作业，在 GitHub macOS 26 上独立执行，不需要 Apple ID、证书或 Supabase 会话。

## 实际检查

1. 正常 CNG 生成工程、安装 CocoaPods，以 Release 构建模拟器应用。没有 App 内测试入口或测试专用 JavaScript 包。
2. 安装到可用 iPhone 模拟器。在本次 CI 应用自己的数据容器中，用合成账本创建原来的三列 `ledger_state` 表。
3. 启动应用，用 macOS Vision 读取模拟器截图上的五个金额：净资产 **5.00**、资产 **85.00**、负债 **80.00**、本月收入 **20.00**、本月支出 **15.00**。
4. 终止应用后，检查原生启动已增加 `sync_json` / `binding_json` / `local_json`，原合成账本没有丢失。
5. 再次启动，重复截图与数据库检查。只有两轮都通过，才生成 `result.txt`。

合成账本：现金期初 100 元、信用卡期初 -100 元；收入 20 元、现金支出 5 元、还款转账 30 元、信用卡消费 10 元。转账不进入收入或支出。日期固定为该次 CI 的 UTC 日期。

## 证据与判定

Actions 的 `simulator-smoke-<commit>` 附件包含 `first.png` / `restart.png`、OCR 文本、数据库检查文本和构建/启动日志，保留 14 天。不能用上传附件成功替代检查通过，必须确认作业结论和 `result.txt`。

若 OCR 没有读出金额，应先检查截图：应用白屏、红屏或读取失败属于运行问题；金额已经正确显示但识别失败属于识别器问题。失败时不得跳过断言或写入假的成功标记。

## 仍未覆盖

- 真实 iPhone 自签安装、键盘、手势、文件选择及分享。
- 原生编辑交易后的 SQLite 提交、撤销与大账本性能。
- 邮箱登录、在线权限、手机/电脑同步和网络中断。
- TestFlight / App Store 签名和审核。

本检查通过时只证明对应提交的模拟器 Release 启动、原生 SQLite 升级/读取以及重新启动后读取。

首轮 1376e19 验收失败：[运行记录](https://github.com/MRaindropR/ledger/actions/runs/37097731067)。截图回到模拟器主屏，应用 stderr 明确报告 `Cannot make a deep link into a standalone app with no custom scheme defined`；应用在 Expo Router 初始化时崩溃。已补显式 `smartledger` 协议，并检查生成的原生 URLTypes，修正后的启动和账本读取仍待新构建验收，不能宣称已经通过。
