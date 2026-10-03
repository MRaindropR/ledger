// Mechanical conversion of typed catch clauses; no application behavior changed.
const fs = require("fs"),
  path = require("path");
const file = path.join(__dirname, "../src/App.tsx");
let text = fs.readFileSync(file, "utf8");
text = text.replace(
  "import {useLedger} from './LedgerProvider';",
  "import {useLedger} from './LedgerProvider';\nimport {errorMessage} from './error';",
);
text = text.replace(
  /catch\(e:any\)\{/g,
  "catch(error:unknown){const e={message:errorMessage(error)};",
);
text = text
  .replace("deleteAccount,emptyLedger,", "deleteAccount,")
  .replace("type Ledger,", "");
fs.writeFileSync(file, text);
