import { initDb } from "./database.js";
import { importSourceExcel } from "./excel.js";

await initDb();
const result = await importSourceExcel();
console.log(`Imported ${result.count} classroom rows from Excel.`);
