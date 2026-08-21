// tableStructureRepair.js
import { BASE, EDITOR, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { ensureSevenTableWorld } from './sevenTableMigration.js?v=memo92';

const WORLD_MEMORY_HEADERS = {
    '当前状态表': ['日期','时间','地点','当前场景人物'],
    '角色状态表': ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'],
    '背包表': ['物品名','类型','数量','状态/品质','备注'],
    '当前任务与约定表': ['事项','相关人物','内容','地点/期限','当前状态'],
    '人物主表': ['姓名','性别','别名/称呼','身份/所属','外貌特征','性格','与玩家关系','重要信息'],
    '人物发展表': ['姓名','修为','主要能力','当前地点','年龄','最后确认时间','当前状态','主要目标/重要事项'],
    '历史事件表': ['时间','地点','涉及人物','事件','结果'],
};
const HEADER_ALIASES = {
    '人物主表': {'别名':'别名/称呼','称呼':'别名/称呼','所属势力':'身份/所属'},
    '人物发展表': {'当前所在地点':'当前地点','所在地点':'当前地点','所在地':'当前地点','确认时间':'最后确认时间','能力':'主要能力','当前目标':'主要目标/重要事项','主要目标':'主要目标/重要事项'},
};
const LEGACY_AGE_ANCHOR_HEADERS = new Set(['年龄/最后确认时间','年龄/确认时间','年龄/时间']);
const KEY_HEADERS = {'角色状态表':['姓名'],'背包表':['物品名','类型','状态/品质'],'当前任务与约定表':['事项'],'人物主表':['姓名'],'人物发展表':['姓名'],'历史事件表':['时间','地点','涉及人物','事件']};
const guardedSheets = new WeakSet();
function normalize(value){return String(value??'').trim();}
function canonicalHeader(sheetName,header){const value=normalize(header);return HEADER_ALIASES[sheetName]?.[value]||value;}
function canonicalizeHeaders(sheetName,headers){return(headers||[]).map(header=>canonicalHeader(sheetName,header));}
function getStructureForSheet(sheet,enabledIndex=-1){const structures=Array.isArray(USER.tableBaseSetting.tableStructure)?USER.tableBaseSetting.tableStructure:[];return structures.find(item=>item.tableName===sheet.name)||structures.find(item=>Number(item.tableIndex)===enabledIndex)||null;}
function getStandardHeaders(sheet,enabledIndex=-1){const canonical=WORLD_MEMORY_HEADERS[sheet?.name];if(canonical)return[...canonical];const structure=getStructureForSheet(sheet,enabledIndex);return Array.isArray(structure?.columns)?structure.columns.map(normalize).filter(Boolean):[];}
function splitValueSheet(valueSheet,sheetName=''){if(!Array.isArray(valueSheet)||!Array.isArray(valueSheet[0]))return{headers:[],rows:[],hasIndexColumn:true};const first=valueSheet[0];const hasIndexColumn=first.length>0&&normalize(first[0])==='';const rawHeaders=(hasIndexColumn?first.slice(1):first).map(normalize);const headers=canonicalizeHeaders(sheetName,rawHeaders);const rows=valueSheet.slice(1).map(row=>{const source=Array.isArray(row)?row:[];return hasIndexColumn?source.slice(1):source.slice();});return{headers,rawHeaders,rows,hasIndexColumn};}
function currentSheetSnapshot(sheet){const rawHeaders=(sheet.getHeader?.()||[]).map(normalize);const headers=canonicalizeHeaders(sheet.name,rawHeaders);const valueSheet=sheet.getContent?.(true);if(!Array.isArray(valueSheet)||valueSheet.length<1)return{headers,rawHeaders,rows:[]};const parsed=splitValueSheet(valueSheet,sheet.name);if(rawHeaders.length&&parsed.headers.length!==rawHeaders.length){const rows=valueSheet.slice(1).map(row=>{const source=Array.isArray(row)?row:[];return source.length===rawHeaders.length+1?source.slice(1):source.slice(0,rawHeaders.length);});return{headers,rawHeaders,rows};}return{headers:headers.length?headers:parsed.headers,rawHeaders:rawHeaders.length?rawHeaders:parsed.rawHeaders,rows:parsed.rows};}
function rowMap(headers,row){const map=new Map();headers.forEach((header,index)=>{if(!header)return;const value=row?.[index]??'';if(!map.has(header)||normalize(map.get(header))==='')map.set(header,value);});return map;}
function splitLegacyAgeAnchor(raw){const value=normalize(raw);if(!value)return{age:'',confirmed:''};const ageOnly=/^(?:约|大约)?\s*\d+(?:\.\d+)?\s*岁$/;const timeLike=/(?:\d{3,6}年(?:\d{1,2}月(?:\d{1,2}日)?)?|\d{2,6}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|\d{1,2}:\d{2}|苍玄历|公元|纪元|历\s*\d+)/;if(ageOnly.test(value))return{age:value,confirmed:''};if(timeLike.test(value)&&!/\d+\s*岁/.test(value))return{age:'',confirmed:value};const ageMatch=value.match(/(?:^|[｜|,，;；\s])((?:约|大约)?\s*\d+(?:\.\d+)?\s*岁)(?=$|[｜|,，;；\s])/);if(ageMatch){const rest=value.replace(ageMatch[0],' ').replace(/^[｜|,，;；\s]+|[｜|,，;；\s]+$/g,'').trim();return{age:ageMatch[1].trim(),confirmed:rest};}return{age:'',confirmed:value};}
function legacyCombinedValue(map){for(const header of LEGACY_AGE_ANCHOR_HEADERS){const value=map.get(header);if(normalize(value))return value;}return '';}
function targetValue(sheetName,header,primary,fallback){const direct=primary.get(header);if(normalize(direct)!=='')return direct;const old=fallback.get(header);if(normalize(old)!=='')return old;if(sheetName==='人物发展表'&&(header==='年龄'||header==='最后确认时间')){const split=splitLegacyAgeAnchor(legacyCombinedValue(primary)||legacyCombinedValue(fallback));return header==='年龄'?split.age:split.confirmed;}return direct??old??'';}
function findOldRow(sheetName,oldSnapshot,incomingHeaders,incomingRow){const oldRows=oldSnapshot.rows||[];if(!oldRows.length)return null;if(sheetName==='当前状态表')return oldRows[oldRows.length-1];if(sheetName==='角色状态表'&&oldRows.length===1)return oldRows[0];const keys=KEY_HEADERS[sheetName]||[];if(keys.length){const incoming=rowMap(incomingHeaders,incomingRow);const usableKeys=keys.filter(key=>incomingHeaders.includes(key)&&normalize(incoming.get(key))!=='');if(usableKeys.length){const candidates=oldRows.filter(oldRow=>{const old=rowMap(oldSnapshot.headers,oldRow);return usableKeys.every(key=>normalize(old.get(key))===normalize(incoming.get(key)));});if(candidates.length===1)return candidates[0];}}return null;}
function isLegacyCombinedHeader(sheetName,header){return sheetName==='人物发展表'&&LEGACY_AGE_ANCHOR_HEADERS.has(normalize(header));}
function conformValueSheetToSchema(sheet,valueSheet,enabledIndex=-1){const standardHeaders=getStandardHeaders(sheet,enabledIndex);if(!standardHeaders.length)return valueSheet;const oldSnapshot=currentSheetSnapshot(sheet);const extraHeaders=(oldSnapshot.rawHeaders||oldSnapshot.headers).filter(header=>header&&!standardHeaders.includes(canonicalHeader(sheet.name,header))&&!isLegacyCombinedHeader(sheet.name,header));const targetHeaders=[...standardHeaders,...extraHeaders];const incoming=splitValueSheet(valueSheet,sheet.name);if(!incoming.headers.length)return valueSheet;const projectedRows=incoming.rows.map(row=>{const incomingValues=rowMap(incoming.headers,row);const oldRow=findOldRow(sheet.name,oldSnapshot,incoming.headers,row);const oldValues=oldRow?rowMap(oldSnapshot.headers,oldRow):new Map();return targetHeaders.map(header=>targetValue(sheet.name,canonicalHeader(sheet.name,header),incomingValues,oldValues));});return[['',...targetHeaders],...projectedRows.map(row=>['',...row])];}
function installWorldMemorySchemaGuard(sheet,enabledIndex=-1){if(!sheet||!WORLD_MEMORY_HEADERS[sheet.name]||guardedSheets.has(sheet))return false;const original=sheet.rebuildHashSheetByValueSheet;if(typeof original!=='function')return false;sheet.rebuildHashSheetByValueSheet=function guardedRebuild(valueSheet,...args){return original.call(this,conformValueSheetToSchema(this,valueSheet,enabledIndex),...args);};guardedSheets.add(sheet);return true;}
function installCurrentWorldMemoryGuards(){const sheets=BASE.getChatSheets?.().filter(sheet=>sheet?.enable)||[];sheets.forEach((sheet,index)=>installWorldMemorySchemaGuard(sheet,index));}
function repairMissingColumnsBeforeCleanup({notify=true}={}){
    ensureSevenTableWorld();
    const{piece}=USER.getChatPiece()||{};if(!piece)return[];
    const sheets=BASE.getChatSheets().filter(sheet=>sheet.enable);
    const sheetBackups=new Map();
    for(const sheet of sheets){const data=sheet.filterSavingData?.();if(!data||typeof data!=='object')throw new Error(`无法备份表格 ${sheet?.name||'未知表'}`);sheetBackups.set(sheet,structuredClone(data));}
    const pieceBackup={hadHash:Object.prototype.hasOwnProperty.call(piece,'hash_sheets'),hash:piece.hash_sheets?structuredClone(piece.hash_sheets):null,extra:structuredClone(piece.extra??{})};
    const repaired=[];
    try{
        sheets.forEach((sheet,enabledIndex)=>{const structure=getStructureForSheet(sheet,enabledIndex);const standardHeaders=getStandardHeaders(sheet,enabledIndex);if(!standardHeaders.length)return;const rawHeaders=sheet.getHeader().map(normalize);const canonicalHeaders=canonicalizeHeaders(sheet.name,rawHeaders);const extraHeaders=rawHeaders.filter(header=>header&&!standardHeaders.includes(canonicalHeader(sheet.name,header))&&!isLegacyCombinedHeader(sheet.name,header));const targetHeaders=[...standardHeaders,...extraHeaders];const missingHeaders=standardHeaders.filter(header=>!canonicalHeaders.includes(header));const needsRepair=rawHeaders.length!==targetHeaders.length||rawHeaders.some((header,index)=>header!==targetHeaders[index]);if(needsRepair){const rows=[];for(let rowIndex=1;rowIndex<sheet.getRowCount();rowIndex++){const cells=sheet.getCellsByRowIndex(rowIndex)||[];const sourceValues=cells.slice(1).map(cell=>cell?.data?.value??'');const oldValuesByHeader=rowMap(canonicalHeaders,sourceValues);rows.push(targetHeaders.map(header=>targetValue(sheet.name,canonicalHeader(sheet.name,header),oldValuesByHeader,new Map())));}sheet.rebuildHashSheetByValueSheet([['',...targetHeaders],...rows.map(row=>['',...row])]);if(sheet.save(piece,true)===false)throw new Error(`保存表格 ${sheet.name} 失败`);repaired.push({tableIndex:structure?.tableIndex??enabledIndex,tableName:sheet.name,missingHeaders,reordered:missingHeaders.length===0});}installWorldMemorySchemaGuard(sheet,enabledIndex);});
    }catch(error){
        const rollbackFailures=[];for(const[sheet,data]of sheetBackups){try{sheet.loadJson(structuredClone(data));}catch(rollbackError){rollbackFailures.push(`${sheet?.name||'未知表'}: ${rollbackError?.message||rollbackError}`);}}
        if(pieceBackup.hadHash)piece.hash_sheets=structuredClone(pieceBackup.hash);else delete piece.hash_sheets;piece.extra=structuredClone(pieceBackup.extra);
        if(rollbackFailures.length)console.error('[Memo] 表头修复整批回滚存在异常',rollbackFailures);
        throw new Error(`${error?.message||error}${rollbackFailures.length?`；回滚异常：${rollbackFailures.join('；')}`:''}`);
    }
    if(repaired.length>0){USER.saveChat();try{BASE.refreshContextView();updateSystemMessageTableStatus();}catch(error){console.warn('[Memo] 表头修复已提交，但视图刷新失败',error);}console.log('[Memo] 已统一七表标准表头:',repaired);if(notify){const summary=repaired.map(item=>item.missingHeaders.length?`${item.tableName}: 补齐/归一 ${item.missingHeaders.join('、')}`:`${item.tableName}: 已恢复标准顺序`).join('；');EDITOR.success(`已统一表头：${summary}`);}}
    return repaired;
}
export{WORLD_MEMORY_HEADERS,conformValueSheetToSchema,installCurrentWorldMemoryGuards,installWorldMemorySchemaGuard,repairMissingColumnsBeforeCleanup};
