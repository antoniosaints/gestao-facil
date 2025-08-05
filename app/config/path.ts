import path from "node:path";
import fs from "node:fs";

const rootPath = path.resolve(__dirname, "../");
let mainPath = path.resolve(__dirname, "../../");
if (fs.existsSync(path.join(mainPath, "code"))) {
  mainPath = path.join(mainPath, "code");
}

export { mainPath, rootPath };
