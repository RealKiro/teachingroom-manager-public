import path from "node:path";
import ExcelJS from "exceljs";
import { db, classroomCount, logAudit, normalizeClassroomValue, nowSql, setClassroomValue } from "./database.js";

const sourceExcel = path.join(process.cwd(), "初始化数据表格（虚拟）.xlsx");

const fallbackSourceFieldMap = {
  orientation: 1,
  room: 2,
  front_door: 2,
  class_name: 3,
  current_screen: 4,
  current_board: 5,
  current_audio: 6,
  install_date: 7,
  department: 8,
  plan_screen: 9,
  plan_board: 10,
  plan_audio: 11,
  plan_recording: 12
};

export async function importSourceExcelIfEmpty() {
  if (classroomCount() > 0) return { imported: false, count: classroomCount() };
  return importSourceExcel(sourceExcel);
}

export async function importSourceExcel(filePath = sourceExcel) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const insertClassroom = db.prepare(`
    INSERT INTO classrooms (building, room)
    VALUES (?, ?)
    ON CONFLICT(building, room) DO UPDATE SET updated_at = ${nowSql}
    RETURNING id
  `);

  const importTx = db.transaction((rows) => {
    for (const row of rows) {
      const classroom = insertClassroom.get(row.building, row.room);
      for (const [fieldKey, value] of Object.entries(row.values)) {
        setClassroomValue(classroom.id, fieldKey, value);
      }
    }
  });

  const rows = extractClassroomRows(workbook, { includeBlankBackDoorForSource: true });

  importTx(rows);
  logAudit(null, "import_excel", "workbook", null, { file: path.basename(filePath), count: rows.length });
  return { imported: true, count: rows.length };
}

export async function parseUploadedWorkbook(filePath, fields = []) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return extractClassroomRows(workbook, { includeBlankBackDoorForSource: false, fields });
}

function extractClassroomRows(workbook, options = {}) {
  const rows = [];
  const headerMap = buildWorkbookHeaderMap(workbook, options.fields || []);
  for (const sheet of workbook.worksheets) {
    if (["导出说明", "字段定义"].includes(sheet.name)) continue;
    const headerRows = findHeaderRows(sheet);
    if (headerRows.exportHeader) {
      rows.push(...extractExportRows(sheet, headerRows.exportHeader, headerMap));
      continue;
    }
    if (headerRows.sourceHeader) {
      rows.push(...extractSourceRows(sheet, options));
    }
  }
  return rows;
}

function extractSourceRows(sheet, options = {}) {
  const rows = [];
  const building = sheet.name.trim();
  let orientation = "";
  const sourceFieldMap = getSourceFieldMap(sheet);

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rawOrientation = cleanCell(row.getCell(sourceFieldMap.orientation || fallbackSourceFieldMap.orientation).value);
    const room = cleanCell(row.getCell(sourceFieldMap.room || fallbackSourceFieldMap.room).value);

    if (rawOrientation) orientation = rawOrientation;
    if (!room || !/^[A-Z]\d+/i.test(room)) continue;

    const values = { building, orientation, room, front_door: room };
    if (options.includeBlankBackDoorForSource) values.back_door = "";
    for (const [fieldKey, columnNumber] of Object.entries(sourceFieldMap)) {
      const value = fieldKey === "orientation" ? orientation : cleanCell(row.getCell(columnNumber).value);
      if (fieldKey === "room") {
        values.room = value;
        values.front_door = value;
      } else {
        values[fieldKey] = normalizeExcelValue(
          fieldKey,
          fieldKey === "install_date" ? formatInstallDate(row.getCell(columnNumber).value) : value
        );
      }
    }
    rows.push({ building, room, values });
  }

  return rows;
}

function getSourceFieldMap(sheet) {
  const headerRows = findHeaderRows(sheet);
  const headerRowNumber = headerRows.sourceHeader || 2;
  const groupRow = sheet.getRow(Math.max(1, headerRowNumber - 1));
  const headerRow = sheet.getRow(headerRowNumber);
  const columnLimit = Math.min(sheet.columnCount || 0, 64);
  const fieldMap = {};

  for (let columnNumber = 1; columnNumber <= columnLimit; columnNumber += 1) {
    const group = cleanCell(groupRow.getCell(columnNumber).value);
    const header = cleanCell(headerRow.getCell(columnNumber).value);
    const fieldKey = sourceFieldKeyFromHeader(header, group);
    if (fieldKey && !fieldMap[fieldKey]) fieldMap[fieldKey] = columnNumber;
  }

  if (!fieldMap.room || !fieldMap.class_name) return fallbackSourceFieldMap;
  return fieldMap;
}

function sourceFieldKeyFromHeader(header, group) {
  const normalizedHeader = header.replace(/\s+/g, "");
  const normalizedGroup = group.replace(/\s+/g, "");
  const inPlan = normalizedGroup.includes("更新计划");
  const inCurrent = normalizedGroup.includes("现有情况");

  if (["朝向", "楼侧"].includes(normalizedHeader)) return "orientation";
  if (["门牌号", "教室编号"].includes(normalizedHeader)) return "room";
  if (["班级", "班级/用途"].includes(normalizedHeader)) return "class_name";
  if (["安装日期", "日期"].includes(normalizedHeader) && !inPlan) return "install_date";
  if (normalizedHeader === "级部") return "department";
  if (["电子屏", "屏幕"].includes(normalizedHeader)) return inPlan ? "plan_screen" : inCurrent ? "current_screen" : null;
  if (normalizedHeader === "书写板") return inPlan ? "plan_board" : inCurrent ? "current_board" : null;
  if (["扩音", "教师扩声", "扩声"].includes(normalizedHeader)) return inPlan ? "plan_audio" : inCurrent ? "current_audio" : null;
  if (normalizedHeader.includes("录播")) return inPlan ? "plan_recording" : "current_recording";
  if (["监控", "现有监控", "监控类型", "摄像头"].includes(normalizedHeader) && !inPlan) return "monitoring";
  return null;
}

function extractExportRows(sheet, headerRowNumber, headerMap) {
  const rows = [];
  const headerRow = sheet.getRow(headerRowNumber);
  const columns = new Map();
  headerRow.eachCell((cell, columnNumber) => {
    const fieldKey = fieldKeyFromHeader(cleanCell(cell.value), headerMap);
    if (fieldKey) columns.set(fieldKey, columnNumber);
  });

  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = {};
    for (const [fieldKey, columnNumber] of columns.entries()) {
      values[fieldKey] = normalizeExcelValue(
        fieldKey,
        fieldKey === "install_date"
          ? formatInstallDate(row.getCell(columnNumber).value)
          : cleanCell(row.getCell(columnNumber).value)
      );
    }

    const room = values.room || values.front_door;
    const building = values.building || sheet.name.trim();
    if (!room || !/^[A-Z]\d+/i.test(room)) continue;
    values.room = room;
    values.building = building;
    if (!values.front_door) values.front_door = room;
    rows.push({ building, room, values });
  }

  return rows;
}

function normalizeExcelValue(fieldKey, value) {
  return normalizeClassroomValue(fieldKey, value);
}

function findHeaderRows(sheet) {
  let exportHeader = null;
  let sourceHeader = null;
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 8); rowNumber += 1) {
    const texts = [];
    sheet.getRow(rowNumber).eachCell((cell) => texts.push(cleanCell(cell.value)));
    if (texts.includes("教室编号") || texts.includes("前门门牌号") || texts.includes("楼栋")) exportHeader = rowNumber;
    if (texts.includes("门牌号") && texts.includes("现有情况")) sourceHeader = rowNumber;
  }
  return { exportHeader, sourceHeader };
}

function fieldKeyFromHeader(header, headerMap = new Map()) {
  const normalized = header.replace(/\s+/g, "");
  if (headerMap.has(normalized)) return headerMap.get(normalized);
  const map = {
    楼栋: "building",
    楼侧: "orientation",
    朝向: "orientation",
    教室编号: "room",
    门牌号: "room",
    前门门牌号: "front_door",
    后门门牌号: "back_door",
    "班级/用途": "class_name",
    班级: "class_name",
    现有电子屏: "current_screen",
    电子屏: "current_screen",
    现有屏幕: "current_screen",
    屏幕: "current_screen",
    书写板类型: "current_board",
    现有书写板: "current_board",
    书写板: "current_board",
    扩音类型: "current_audio",
    现有扩音: "current_audio",
    扩音: "current_audio",
    教师扩声: "current_audio",
    现有教师扩声: "current_audio",
    教师扩声类型: "current_audio",
    扩声: "current_audio",
    现有扩声: "current_audio",
    扩声类型: "current_audio",
    录播: "current_recording",
    现有录播: "current_recording",
    是否有录播: "current_recording",
    监控: "monitoring",
    现有监控: "monitoring",
    监控类型: "monitoring",
    摄像头: "monitoring",
    计划录播: "plan_recording",
    "2026暑期更新计划录播": "plan_recording",
    安装日期: "install_date",
    日期: "install_date",
    级部: "department",
    计划电子屏: "plan_screen",
    计划屏幕: "plan_screen",
    "2026暑期更新计划电子屏": "plan_screen",
    "2026暑期更新计划屏幕": "plan_screen",
    计划书写板: "plan_board",
    "2026暑期更新计划书写板": "plan_board",
    计划扩音: "plan_audio",
    计划教师扩声: "plan_audio",
    计划扩声: "plan_audio",
    "2026暑期更新计划扩音": "plan_audio",
    "2026暑期更新计划教师扩声": "plan_audio",
    "2026暑期更新计划扩声": "plan_audio",
    巡查备注: "inspection_note"
  };
  return map[normalized] || null;
}

function buildWorkbookHeaderMap(workbook, fields = []) {
  const map = new Map();
  for (const field of fields) {
    if (field?.key) map.set(String(field.key).replace(/\s+/g, ""), field.key);
    if (field?.label) map.set(String(field.label).replace(/\s+/g, ""), field.key);
  }

  const metadata = workbook.getWorksheet("字段定义");
  if (metadata) {
    for (let rowNumber = 2; rowNumber <= metadata.rowCount; rowNumber += 1) {
      const key = cleanCell(metadata.getRow(rowNumber).getCell(1).value);
      const label = cleanCell(metadata.getRow(rowNumber).getCell(2).value);
      if (!key) continue;
      map.set(key.replace(/\s+/g, ""), key);
      if (label) map.set(label.replace(/\s+/g, ""), key);
    }
  }
  return map;
}

export async function buildExportWorkbook(records, fields, exportOptions = {}) {
  const options = typeof exportOptions === "string" ? { title: exportOptions } : exportOptions;
  const title = options.title || "教室设备清单";
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TeachingRoom Manager";
  workbook.created = new Date();

  const exportFields = fields;
  const byBuilding = new Map();
  for (const record of records) {
    const building = record.values.building || record.building || "未分组";
    if (!byBuilding.has(building)) byBuilding.set(building, []);
    byBuilding.get(building).push(record);
  }

  for (const [building, rows] of byBuilding.entries()) {
    const sheet = workbook.addWorksheet(building);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.addRow(exportFields.map((field) => field.label));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1769AA" } };
    sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    for (const record of rows) {
      sheet.addRow(exportFields.map((field) => record.values[field.key] || ""));
    }

    sheet.columns = exportFields.map((field) => ({
      key: field.key,
      width: Math.max(10, Math.min(24, field.label.length * 3 + 8))
    }));
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: exportFields.length }
    };
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9E1EA" } },
          left: { style: "thin", color: { argb: "FFD9E1EA" } },
          bottom: { style: "thin", color: { argb: "FFD9E1EA" } },
          right: { style: "thin", color: { argb: "FFD9E1EA" } }
        };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    });
  }

  const metadata = workbook.addWorksheet("字段定义");
  metadata.state = "veryHidden";
  metadata.addRow(["字段标识", "显示名称"]);
  for (const field of exportFields) metadata.addRow([field.key, field.label]);

  const summary = workbook.addWorksheet("导出说明", { properties: { tabColor: { argb: "FF217346" } } });
  summary.addRows(buildExportSummaryRows(records, title, options));
  summary.columns = [{ width: 20 }, { width: 80 }];
  summary.eachRow((row) => {
    row.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E1EA" } },
        left: { style: "thin", color: { argb: "FFD9E1EA" } },
        bottom: { style: "thin", color: { argb: "FFD9E1EA" } },
        right: { style: "thin", color: { argb: "FFD9E1EA" } }
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (colNumber === 1) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2F8" } };
      }
    });
  });

  return workbook;
}

function buildExportSummaryRows(records, title, options = {}) {
  const query = options.query || {};
  const summary = options.summary || buildLocalExportSummary(records);
  const allTotal = Number(options.allSummary?.total || 0);
  const filtered = isFilteredExport(query, records.length, allTotal);
  const filterText = describeExportFilters(query, filtered);
  const scope = filtered ? "筛选结果" : "全部数据";

  return [
    ["名称", title],
    ["导出时间", new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })],
    ["导出范围", scope],
    ["是否筛选", filtered ? "是" : "否"],
    ["筛选条件", filterText || "无"],
    ["记录数量", String(records.length)],
    ["涉及更新", String(summary.planned || 0)],
    ["待审核", String(summary.pending || 0)],
    ["楼栋分布", formatSummaryMap(summary.byBuilding)],
    ["更新项目统计", formatPlanSummary(summary.byPlan)],
    ["说明", `本文件由教室设备管理系统按${scope}导出，统计结果仅基于本次导出的记录。`]
  ];
}

function buildLocalExportSummary(records) {
  const planKeys = ["plan_screen", "plan_board", "plan_audio", "plan_recording"];
  return {
    total: records.length,
    planned: records.filter((record) => planKeys.some((key) => record.values[key])).length,
    pending: records.filter((record) => record.pendingChanges > 0).length,
    byBuilding: countByLocal(records, (record) => record.values.building || record.building || "未分组"),
    byPlan: {
      screen: records.filter((record) => record.values.plan_screen).length,
      board: records.filter((record) => record.values.plan_board).length,
      audio: records.filter((record) => record.values.plan_audio).length,
      recording: records.filter((record) => record.values.plan_recording).length
    }
  };
}

function countByLocal(items, getKey) {
  return items.reduce((result, item) => {
    const key = getKey(item);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function isFilteredExport(query, recordCount, allTotal) {
  if (visibleFilterParts(query).length) return true;
  const idsCount = parseExportIds(query.ids).length;
  return Boolean(idsCount && allTotal && recordCount !== allTotal);
}

function describeExportFilters(query = {}, filtered = false) {
  const parts = visibleFilterParts(query);
  const idsCount = parseExportIds(query.ids).length;
  if (idsCount && filtered) parts.push(`当前列表精确导出：${idsCount} 条`);
  return parts.join("；");
}

function visibleFilterParts(query = {}) {
  const parts = [];
  const search = String(query.search || "").trim();
  const building = String(query.building || "").trim();
  const department = String(query.department || "").trim();
  const orientation = String(query.orientation || query.side || "").trim();
  const planned = String(query.planned || "").trim();
  const pending = String(query.pending || "").trim();

  if (search) parts.push(`关键字：${search}`);
  if (building) parts.push(`楼栋：${building}`);
  if (department) parts.push(`级部：${department}`);
  if (orientation) parts.push(`楼侧：${orientation}`);
  if (planned) parts.push(`更新计划：${plannedLabel(planned)}`);
  if (pending === "yes") parts.push("审核状态：待审核");
  if (pending === "no") parts.push("审核状态：无待审核");
  return parts;
}

function parseExportIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function plannedLabel(value) {
  return {
    yes: "有任一更新",
    no: "无更新项目",
    screen: "屏幕",
    board: "书写板",
    audio: "教师扩声",
    recording: "录播"
  }[value] || value;
}

function formatSummaryMap(map = {}) {
  const entries = Object.entries(map).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return "无";
  return entries.map(([key, value]) => `${key}：${value}`).join(" / ");
}

function formatPlanSummary(map = {}) {
  const entries = [
    ["屏幕", map.screen],
    ["书写板", map.board],
    ["教师扩声", map.audio],
    ["录播", map.recording]
  ].filter(([, value]) => Number(value) > 0);
  if (!entries.length) return "无";
  return entries.map(([key, value]) => `${key}：${value}`).join(" / ");
}

function cleanCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("zh-CN");
  if (typeof value === "object") {
    if ("text" in value) return cleanCell(value.text);
    if ("result" in value) return cleanCell(value.result);
    if ("richText" in value) return value.richText.map((item) => item.text).join("").trim();
    if ("hyperlink" in value && "text" in value) return cleanCell(value.text);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function formatInstallDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return `${value.getFullYear()}年${value.getMonth() + 1}月`;
  if (typeof value === "number") {
    const date = excelSerialToDate(value);
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }
  const text = cleanCell(value);
  if (/^\d+(\.\d+)?$/.test(text)) {
    const date = excelSerialToDate(Number(text));
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }
  return text;
}

function excelSerialToDate(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86400000);
}
