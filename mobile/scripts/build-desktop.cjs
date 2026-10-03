/* Mechanical migration of the existing desktop UI. Never overwrites the user's file. */
const fs = require("node:fs");
const path = require("node:path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const esbuild = require("esbuild");
const outputDir = path.resolve(__dirname, "../../desktop");
const baseline = path.join(outputDir, "legacy-ui.html");
const sourceArg = process.argv.indexOf("--source");
const input = sourceArg >= 0 ? process.argv[sourceArg + 1] : baseline;
const statement = (text) =>
  parser.parse(text, {
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  }).program.body[0];
const expression = (text) => parser.parseExpression(text);
function requireMatch(count, label) {
  if (count !== 1)
    throw Error(`UI migration expected one ${label}, found ${count}`);
}
async function main() {
  let html = fs.readFileSync(input, "utf8");
  const cloudStart = html.indexOf(
    "/* =========== Supabase Cloud Sync =========== */",
  );
  const cloudEnd = html.indexOf(
    "/* =========== Main App =========== */",
    cloudStart,
  );
  if (cloudStart >= 0 && cloudEnd > cloudStart) {
    html =
      html.slice(0, cloudStart) +
      `let _onCloudStatusChange = null;
function getCloudKey(){return window.SmartLedgerDesktop.getState().row?.snapshot.binding ? 'native' : '';}
` +
      html.slice(cloudEnd);
  }
  if (html.includes("SUPA_KEY") || html.includes("sync_data"))
    throw Error("Legacy cloud credentials or whole-ledger sync remain");
  fs.mkdirSync(outputDir, { recursive: true });
  if (sourceArg >= 0) fs.writeFileSync(baseline, html);
  let found = 0;
  html = html.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/g,
    (whole, attrs, code) => {
      if (!code.includes("function BackupPage")) return whole;
      found++;
      const ast = parser.parse(code);
      const counts = {
        backup: 0,
        state: 0,
        save: 0,
        start: 0,
        excel: 0,
        read: 0,
      };
      traverse(ast, {
        FunctionDeclaration(p) {
          const name = p.node.id?.name;
          if (name === "BackupPage") {
            for (const s of p.node.body.body) {
              if (t.isReturnStatement(s) && t.isCallExpression(s.argument)) {
                const args = s.argument.arguments;
                if (args.length !== 7)
                  throw Error("Unexpected BackupPage layout");
                args[6] = expression(
                  "React.createElement(window.SmartLedgerDesktop.Panel, null)",
                );
                counts.backup++;
              }
            }
            // Remove dead legacy cloud handlers and their state. They must never be callable.
            p.node.body.body = p.node.body.body.filter(
              (s) =>
                !(
                  t.isVariableDeclaration(s) &&
                  s.declarations.some(
                    (d) =>
                      t.isIdentifier(d.id) &&
                      ["handleSaveKey", "handlePull"].includes(d.id.name),
                  )
                ),
            );
          }
          if (name === "saveData") {
            p.node.body = statement(
              `function saveData(st){if(!_fileHandle)return;if(_fileSaveTimer)clearTimeout(_fileSaveTimer);_fileSaveTimer=setTimeout(async()=>{const ok=await _writeToFile(st);if(!ok&&_onSaveStatusChange)_onSaveStatusChange({state:'error',error:'关联数据文件写入失败'});},1200);}`,
            ).body;
            counts.save++;
          }
          if (name === "reconnectFile") {
            // Reconnection resumes the backup mirror; an old file must not replace a synced ledger.
            p.traverse({
              IfStatement(q) {
                if (generate(q.node.test).code === "text.trim()") q.remove();
              },
            });
          }
          if (name === "App") {
            p.node.body.body.unshift(
              statement(
                `useEffect(()=>{const refresh=()=>{const s=window.SmartLedgerDesktop.getState();setSaveStatus(s.save);setCloudStatus(s.cloud);setCloudKeyState(s.row?.snapshot.binding?'native':'');};refresh();return window.SmartLedgerDesktop.subscribe(refresh);},[]);`,
              ),
            );
            // Effect callbacks run after the declarations below have initialized.
          }
        },
        VariableDeclarator(p) {
          if (
            t.isIdentifier(p.node.id, { name: "dpu" }) &&
            t.isCallExpression(p.node.init)
          ) {
            const callback = p.node.init.arguments[0];
            if (
              !t.isArrowFunctionExpression(callback) ||
              !t.isBlockStatement(callback.body)
            )
              throw Error("Unexpected dispatch callback");
            callback.async = true;
            callback.body.body[0] = statement(
              "if(await dp(ac)===false)return;",
            );
          }
          if (
            t.isArrayPattern(p.node.id) &&
            p.node.id.elements[0]?.name === "st" &&
            t.isCallExpression(p.node.init) &&
            t.isIdentifier(p.node.init.callee, { name: "useReducer" })
          ) {
            p.node.init = expression(
              "window.SmartLedgerDesktop.useApp(reducer)",
            );
            counts.state++;
          }
        },
        CallExpression(p) {
          if (
            t.isIdentifier(p.node.callee, { name: "dp" }) &&
            t.isObjectExpression(p.node.arguments[0]) &&
            p.node.arguments[0].properties.some(
              (prop) =>
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key, { name: "type" }) &&
                t.isStringLiteral(prop.value, { value: "RESTORE" }),
            )
          ) {
            const importOwner = p.findParent(
              (q) =>
                q.isVariableDeclarator() &&
                t.isIdentifier(q.node.id, { name: "doImport" }),
            );
            const fileOwner = p.findParent(
              (q) =>
                q.isFunctionDeclaration() && q.node.id.name === "linkJsonFile",
            );
            if (importOwner || fileOwner) {
              const data = p.node.arguments[0].properties.find(
                (prop) =>
                  t.isObjectProperty(prop) &&
                  t.isIdentifier(prop.key, { name: "p" }),
              ).value;
              if (importOwner) {
                const callback = p.findParent((q) =>
                  q.isArrowFunctionExpression(),
                );
                callback.node.async = true;
              }
              const call = t.callExpression(
                expression("window.SmartLedgerDesktop.restore"),
                [data],
              );
              p.parentPath.replaceWith(
                t.expressionStatement(t.awaitExpression(call)),
              );
              if (fileOwner)
                p.parentPath.insertBefore(
                  statement(
                    "if(!confirm('导入此文件并替换当前账本？已连接的云端账本也会更新，请先导出备份。'))return null;",
                  ),
                );
              return;
            }
          }
          if (t.isIdentifier(p.node.callee, { name: "scheduledCloudPush" })) {
            p.parentPath.remove();
            return;
          }
          if (
            t.isMemberExpression(p.node.callee) &&
            t.isIdentifier(p.node.callee.object, { name: "XLSX" }) &&
            t.isIdentifier(p.node.callee.property, { name: "writeFile" })
          ) {
            p.parentPath.insertBefore(
              statement("window.SmartLedgerDesktop.addWorkbookJSON(wb, XLSX);"),
            );
            counts.excel++;
          }
          if (
            t.isMemberExpression(p.node.callee) &&
            t.isIdentifier(p.node.callee.object, { name: "XLSX" }) &&
            t.isIdentifier(p.node.callee.property, { name: "read" }) &&
            p.findParent(
              (q) =>
                q.isVariableDeclarator() &&
                t.isIdentifier(q.node.id, { name: "doImport" }),
            )
          ) {
            const declaration = p.findParent((q) => q.isVariableDeclaration());
            declaration.insertAfter([
              statement(
                `const nativeData=window.SmartLedgerDesktop.readWorkbookJSON(wb,XLSX);`,
              ),
              statement(
                `if(nativeData){if(!confirm('恢复此备份？当前本机账本将被替换；若已连接云端，修改也会同步。请先导出当前备份。'))return;window.SmartLedgerDesktop.restore(nativeData).then(()=>{setMsgType('ok');setMsg('账本已保存');}).catch(e=>{setMsgType('err');setMsg('恢复失败：'+e.message);});return;}`,
              ),
            ]);
            counts.read++;
          }
          if (
            t.isIdentifier(p.node.callee, { name: "_writeToFile" }) &&
            p.findParent(
              (q) =>
                q.isFunctionDeclaration() &&
                q.node.id.name === "createJsonFile",
            )
          )
            p.node.arguments = [expression("st")];
        },
        TryStatement(p) {
          if (
            p.parentPath.isProgram() &&
            generate(p.node.block).code.includes("ReactDOM.createRoot")
          ) {
            p.replaceWith(
              statement(
                `window.SmartLedgerDesktop.initialize(loadSaved()).then(()=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App,null))).catch(err=>{const root=document.getElementById('root');root.textContent='账本加载失败：'+err.message;root.style.cssText='padding:40px;color:#c45b68;font-family:sans-serif';});`,
              ),
            );
            counts.start++;
          }
        },
      });
      for (const [label, count] of Object.entries(counts))
        requireMatch(count, label);
      const generated = generate(ast, { comments: true }).code;
      parser.parse(generated);
      return `<script${attrs}>\n${generated.replace(/<\/script/gi, "<\\/script")}\n</script>`;
    },
  );
  requireMatch(found, "app script");
  const bundle = await esbuild.build({
    entryPoints: [path.resolve(__dirname, "../src/desktop/bridge.tsx")],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "iife",
    target: ["chrome100", "safari15.4"],
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    tsconfigRaw: {
      compilerOptions: {
        jsx: "react",
        jsxFactory: "React.createElement",
        jsxFragmentFactory: "React.Fragment",
      },
    },
    minify: true,
    plugins: [
      {
        name: "existing-react",
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({
            path: "react",
            namespace: "legacy-react",
          }));
          build.onLoad({ filter: /.*/, namespace: "legacy-react" }, () => ({
            contents: "module.exports = window.React;",
            loader: "js",
          }));
        },
      },
    ],
  });
  if (
    Object.keys(bundle.metafile.inputs).some(
      (name) =>
        name.includes("react/jsx-runtime") || name.includes("react/cjs/"),
    )
  )
    throw Error("Desktop must reuse the existing React runtime");
  const bridge = bundle.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  const marker = html.indexOf(
    "<script",
    html.indexOf("function BackupPage") > 0
      ? html.lastIndexOf("<script", html.indexOf("function BackupPage"))
      : 0,
  );
  if (marker < 0) throw Error("App script insertion failed");
  html =
    html.slice(0, marker) +
    `<script>\n${bridge}\n</script>\n` +
    html.slice(marker);
  fs.writeFileSync(path.join(outputDir, "index.html"), html);
  console.log(
    `Desktop HTML generated (${Buffer.byteLength(html)} bytes), original preserved.`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
